import DemoTemplate from './demo/Template';
import CommonHeader from './common/common-header';
import CommonFooter from './common/common-footer';
import VulnerabilitiesSystemTemplate from './vulnerability/vulnerabilities-system/Template';
import ServiceNames from '../common/service-names';
import VulnerabilityTemplate from './vulnerability/advanced-cve-report/Template';
import VulnerabilityExecutiveReportTemplate from './vulnerability/executive-report/Template';
import AdvisorTemplate from './advisor/Template';
import ComplianceTemplate from './compliance/template';
import RosExecutiveTemplate from './ros/executive-report';
import CveReport from './vulnerability/cve-report/Template';
import CveFooter from './vulnerability/cve-report/CveFooter';

export type TemplateElement = (props: any) => JSX.Element;

export type ServiceTemplate = {
  template: TemplateElement;
  header: TemplateElement;
  footer: TemplateElement;
  browserMargins?: {
    top?: string;
    bottom?: string;
    right?: string;
    left?: string;
  };
  landscape?: boolean;
};

export type TemplateMapper = {
  [key in ServiceNames]: {
    [key: string]: ServiceTemplate;
  };
};

const templates: TemplateMapper = {
  [ServiceNames.demo]: {
    demo: {
      template: DemoTemplate,
      header: CommonHeader,
      footer: CommonFooter,
    },
  },
  [ServiceNames.compliance]: {
    report: {
      template: ComplianceTemplate,
      header: CommonHeader,
      footer: CommonFooter,
    },
  },
  [ServiceNames.vulnerability]: {
    vulnerabilities: {
      template: VulnerabilityTemplate,
      landscape: true,
      header: CommonHeader,
      footer: CommonFooter,
    },
    systems: {
      template: VulnerabilitiesSystemTemplate,
      header: CommonHeader,
      footer: CommonFooter,
      landscape: true,
      browserMargins: {
        bottom: '2.5cm',
      },
    },
    cve: {
      template: CveReport,
      header: CommonHeader,
      footer: CveFooter,
      landscape: true,
      browserMargins: {
        bottom: '2.5cm',
      },
    },
    executive: {
      template: VulnerabilityExecutiveReportTemplate,
      header: CommonHeader,
      footer: CommonFooter,
      landscape: true,
    },
  },
  [ServiceNames.advisor]: {
    advisor: {
      template: AdvisorTemplate,
      header: CommonHeader,
      footer: CommonFooter,
    },
  },
  [ServiceNames.ros]: {
    executiveReport: {
      template: RosExecutiveTemplate,
      header: CommonHeader,
      footer: CommonFooter,
    },
  },
};

export default templates;
