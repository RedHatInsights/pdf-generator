import { ServiceCallFunction } from '../call-service';
import ServiceNames from '../service-names';

const demoData = {
  title: 'Foo',
  description: 'bar',
};

const getMock: ServiceCallFunction = () => Promise.resolve(demoData);
const responseProcessor = (data: typeof demoData) => data;

const demoDescriptor = {
  responseProcessor,
  path: '/',
  service: ServiceNames.demo,
  mock: getMock,
};

export default demoDescriptor;
