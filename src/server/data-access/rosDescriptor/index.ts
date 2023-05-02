import { ServiceCallFunction, ServiceDescriptor } from '../call-service';
import ServiceNames from '../../../common/service-names';
import config from '../../../common/config';
import rosData from './rosData';
import axios, { AxiosRequestHeaders } from 'axios';

const BASE_URL = `http://${config?.endpoints['ros-backend']?.hostname}:${config?.endpoints['ros-backend']?.port}/api/ros/v1`;
const EXECUTIVE_REPORT_URL = `${BASE_URL}/executive_report`;

const getExecutiveReport = async (headers: AxiosRequestHeaders) => {
  const { data } = await axios.get<{ data: typeof rosData }>(
    EXECUTIVE_REPORT_URL,
    {
      headers,
    }
  );
  return { data };
};

const getMock: ServiceCallFunction = () => Promise.resolve({ data: rosData });
const responseProcessor = (data: typeof rosData) => data;

const rosDescriptor: ServiceDescriptor = {
  templates: {
    executiveReport: {
      service: ServiceNames.ros,
      responseProcessor,
      path: '/',
      request: getExecutiveReport,
      mock: getMock,
    },
  },
};

export default rosDescriptor;
