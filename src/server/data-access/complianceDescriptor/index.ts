import ServiceNames from '../../../common/service-names';
import { ServiceCallFunction, ServiceDescriptor } from '../call-service';
import { complianceData } from './complianceData';
import axios, { AxiosRequestHeaders, AxiosResponse } from 'axios';
import config from '../../../common/config';

const getMock: ServiceCallFunction = () => Promise.resolve(complianceData);
const responseProcessor = (data: typeof complianceData) => data;

const getPolicyQuery = {
  operationName: 'Profile',
  query: `
  query Profile($policyId: String!) {
    profile(id: $policyId) {
      id
      name
      refId
      testResultHostCount
      compliantHostCount
      unsupportedHostCount
      complianceThreshold
      osMajorVersion
      lastScanned
      policyType
      totalHostCount
      policy {
        id
        name
      }
      benchmark {
        id
      }
      businessObjective {
        id
        title
      }
    }
  }
`,
};

const getRulesQuery = {
  operationName: 'getProfiles',
  query: `
  query getProfiles($filter: String!, $policyId: ID!) {
    profiles(search: $filter) {
      totalCount
      edges {
        node {
          topFailedRules(policyId: $policyId) {
            refId
            title
            remediationAvailable
            severity
            identifier
            failedCount
          }
        }
      }
    }
  }
`,
};

const getSystemsQuery = {
  operationName: 'getSystems',
  query: `
  query getSystems(
    $filter: String!
    $policyId: ID
    $perPage: Int
    $page: Int
    $sortBy: [String!]
    $tags: [String!]
  ) {
    systems(
      search: $filter
      limit: $perPage
      offset: $page
      sortBy: $sortBy
      tags: $tags
    ) {
      totalCount
      edges {
        node {
          id
          name
          osMajorVersion
          osMinorVersion
          insightsId
          testResultProfiles(policyId: $policyId) {
            lastScanned
            compliant
            score
            supported
            benchmark {
              version
            }
            rulesFailed
          }
        }
      }
    }
  }
`,
};

type RuleResponse = {
  data: {
    profiles?: {
      totalCount: number;
      edges: {
        node: {
          topFailedRules: {
            failedCount: number;
          }[];
        };
      }[];
    };
  };
};

type Profile = {
  lastScanned: string;
  compliant: boolean;
  supported: boolean;
};

type System = {
  testResultProfiles: Profile[];
  id: string;
};

const scannedProfiles = (profiles: Profile[]) =>
  profiles?.filter((profile) => profile.lastScanned != 'Never') || [];

const isSystemCompliant = (system: System) => {
  const hasScannedProfiles =
    scannedProfiles(system.testResultProfiles).length > 0;
  const hasOnlyCompliantScannedProfiles = scannedProfiles(
    system.testResultProfiles
  ).every((profile) => profile.compliant);

  return hasScannedProfiles && hasOnlyCompliantScannedProfiles;
};

const isSystemNonCompliant = (system: System) => {
  const hasScannedProfiles =
    scannedProfiles(system.testResultProfiles).length > 0;
  const hasNonCompliantProfiles =
    scannedProfiles(system.testResultProfiles).filter(
      (profile) => !profile.compliant
    ).length > 0;

  return hasScannedProfiles && hasNonCompliantProfiles;
};

const hasProfiles = ({ testResultProfiles }: System) =>
  scannedProfiles(testResultProfiles).length > 0;

const isSystemSupported = (system: System) =>
  hasProfiles(system) &&
  scannedProfiles(system.testResultProfiles).every(
    (profile) => profile.supported
  );

const isSystemUnsupported = (system: System) =>
  hasProfiles(system) &&
  scannedProfiles(system.testResultProfiles).every(
    (profile) => !profile.supported
  );

export const compliantSystemsData = (systems: System[]) =>
  systems.filter(
    (system) => isSystemSupported(system) && isSystemCompliant(system)
  );

export const nonCompliantSystemsData = (systems: System[]) =>
  systems.filter(
    (system) => isSystemSupported(system) && isSystemNonCompliant(system)
  );

export const unsupportedSystemsData = (systems: System[]) =>
  systems.filter((system) => isSystemUnsupported(system));

export const supportedSystemsData = (systems: System[]) =>
  systems.filter((system) => isSystemSupported(system));

export const nonReportingSystemsData = (systems: System[]) => {
  const reportingSystemIds = [
    ...compliantSystemsData(systems),
    ...nonCompliantSystemsData(systems),
    ...unsupportedSystemsData(systems),
  ].map((system) => system.id);

  return systems.filter((system) => !reportingSystemIds.includes(system.id));
};

type ExportSettings = {
  compliantSystems: boolean;
  nonCompliantSystems: boolean;
  unsupportedSystems: boolean;
  topTenFailedRules: boolean;
  nonReportingSystems: boolean;
  userNotes?: Record<string, unknown>;
};

export const prepareForExport = (
  exportSettings: ExportSettings,
  systems: System[],
  topTenFailedRules: undefined | unknown[]
) => {
  const compliantSystems = compliantSystemsData(systems);
  const nonCompliantSystems = nonCompliantSystemsData(systems);
  const unsupportedSystems = unsupportedSystemsData(systems);
  const nonReportingSystems = nonReportingSystemsData(systems);

  return {
    totalHostCount: systems.length,

    compliantSystemCount: compliantSystems.length,
    ...(exportSettings.compliantSystems && {
      compliantSystems: compliantSystems,
    }),

    nonCompliantSystemCount: nonCompliantSystems.length,
    ...(exportSettings.nonCompliantSystems && {
      nonCompliantSystems: nonCompliantSystems,
    }),

    unsupportedSystemCount: unsupportedSystems.length,
    ...(exportSettings.unsupportedSystems && {
      unsupportedSystems: unsupportedSystems,
    }),

    ...(exportSettings.topTenFailedRules && {
      topTenFailedRules,
    }),
    nonReportingSystemCount: nonReportingSystems.length,
    ...(exportSettings.nonReportingSystems && {
      nonReportingSystems: nonReportingSystems,
    }),
    ...(exportSettings.userNotes && { userNotes: exportSettings.userNotes }),
  };
};

const fetchBatched = <T>(
  fetchFunction: (batchSize: number, page: number) => Promise<T>,
  total: number,
  batchSize = 50
) => {
  const pages = Math.ceil(total / batchSize) || 1;
  return Promise.all(
    [...new Array(pages)].map((_, pageIdx) =>
      fetchFunction(batchSize, pageIdx + 1)
    )
  );
};

const fetchQQl = <R = any>(
  query: Record<string, any>,
  headers: AxiosRequestHeaders,
  perPage: number | undefined,
  page: number | undefined,
  policyId: string | number
) => {
  const URL = `http://${config?.endpoints?.compliance?.hostname}:${config?.endpoints?.compliance?.port}/api/compliance/graphql`;
  return axios.post<any, AxiosResponse<R>>(
    URL,
    {
      ...query,
      variables: {
        ...(perPage ? { perPage } : {}),
        ...(page ? { page } : {}),
        filter: `policy_id = ${policyId}`,
        policyId,
      },
    },
    { headers }
  );
};

export const getPolicyData = async (
  headers: AxiosRequestHeaders,
  { policyId, totalHostCount }: Record<string, any>
) => {
  const { data } = await fetchQQl(
    getPolicyQuery,
    headers,
    undefined,
    undefined,
    policyId
  );
  const fetchSystems = (perPage: number, page: number) =>
    fetchQQl(getSystemsQuery, headers, perPage, page, policyId);
  const fetchRules = (perPage = 10, page = 1) =>
    fetchQQl<RuleResponse>(getRulesQuery, headers, page, perPage, policyId);

  const batchedSystems = await fetchBatched<{
    data: {
      data: {
        systems: {
          edges: {
            node: System;
          }[];
        };
      };
    };
  }>(fetchSystems, totalHostCount);
  const { data: rules } = await fetchRules();
  const systems = batchedSystems
    .map((r) => r.data)
    .flatMap(
      ({
        data: {
          systems: { edges },
        },
      }) => edges.map(({ node }) => node)
    );
  const rulesParsed = rules.data?.profiles?.edges.flatMap(
    (edge) => edge.node.topFailedRules
  );

  const exportData = prepareForExport(
    {
      compliantSystems: true,
      nonCompliantSystems: true,
      unsupportedSystems: true,
      topTenFailedRules: true,
      nonReportingSystems: true,
    },
    systems,
    rulesParsed
  );
  const PDFdata = {
    policy: data.data.profile || {},
    ...exportData,
  };
  return PDFdata;
};

const complianceDescriptor: ServiceDescriptor = {
  templates: {
    report: {
      service: ServiceNames.compliance,
      responseProcessor,
      path: '/api/compliance/v1/status',
      request: getPolicyData,
      mock: getMock,
    },
  },
};

export default complianceDescriptor;
