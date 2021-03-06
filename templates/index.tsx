// import AutomationAnalyticsTemplate from './automation-analytics/App';
// import AutomationAnalyticsHeaderTemplate from './automation-analytics/header-template';
// import AutomationAnalyticsFooterTemplate from './automation-analytics/footer-template';
import DemoTemplate from './demo/Template';
import CommonHeader from './common/common-header';
import CommonFooter from './common/common-footer';
import VulnerabilitiesSystemTemplate from './vulnerabilities-system/Template';
import ServiceNames from '../server/data-access/service-names';
import VulnerabilityTemplate from './vulnerability/Template';
import AdvisorTemplate from './advisor/Template';
import ComplianceTemplate from './compliance/template';

export const headerTeamplteMapper = {
  // 'automation-analytics': AutomationAnalyticsHeaderTemplate,
  [ServiceNames.demo]: CommonHeader,
  [ServiceNames.compliance]: CommonHeader,
  [ServiceNames.vulnerability]: CommonHeader,
  [ServiceNames.advisor]: CommonHeader,
  [ServiceNames.vulnerabilitiesSystem]: CommonHeader,
};

export const footerTemplateMapper = {
  // 'automation-analytics': AutomationAnalyticsFooterTemplate,
  [ServiceNames.demo]: CommonFooter,
  [ServiceNames.compliance]: CommonFooter,
  [ServiceNames.vulnerability]: CommonFooter,
  [ServiceNames.advisor]: CommonFooter,
  [ServiceNames.vulnerabilitiesSystem]: CommonFooter,
};

const templates = {
  // 'automation-analytics': AutomationAnalyticsTemplate,
  [ServiceNames.demo]: DemoTemplate,
  [ServiceNames.compliance]: ComplianceTemplate,
  [ServiceNames.vulnerability]: VulnerabilityTemplate,
  [ServiceNames.advisor]: AdvisorTemplate,
  [ServiceNames.vulnerabilitiesSystem]: VulnerabilitiesSystemTemplate,
};

export default templates;
