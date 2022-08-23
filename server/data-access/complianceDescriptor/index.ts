import ServiceNames from '../service-names';
import { ServiceCallFunction } from '../call-service';
import { complianceData } from './complianceData';

const getMock: ServiceCallFunction = () => Promise.resolve(complianceData);
const responseProcessor = (data: typeof complianceData) => data;

const complianceDescriptor = {
  responseProcessor,
  path: '/api/compliance/graphql',
  options: {
    method: 'POST',
  },
  service: ServiceNames.compliance,
  mock: getMock,
};

export default complianceDescriptor;
