import {
  ChartKind,
  ChartLegendOrientation,
  ChartLegendPosition,
  ChartTopLevelType,
  ChartThemeColor,
  ChartSchemaElement,
  ChartType,
} from 'react-json-chart-builder';
import { ReportLayout } from '../Components/ReportComponents/types';
import { ReportSchema } from './types';

const slug = 'aa_2_1_onboarding';

const name = 'AA 2.1 Onboarding Report';

const description = `This report shows templates that utilize certain module types that have been identified to pose potential problems when migrating to AAP 2.1.

  You can use this report to determine the last job run of these templates, as well as a link into the Controller instance where the template is defined.`;

const tableHeaders = [
  { key: 'id', value: 'ID' },
  { key: 'name', value: 'Template name' },
  { key: 'host_task_count', value: 'Tasks count' },
];

const schema: ChartSchemaElement[] = [
  {
    id: 1,
    kind: ChartKind.wrapper,
    type: ChartTopLevelType.chart,
    parent: null,
    props: {
      height: 475,
      padding: {
        top: 70,
        right: 180,
      },
      themeColor: ChartThemeColor.multiOrdered,
    },
    xAxis: {
      label: 'Date',
      tickFormat: 'VAR_xTickFormat',
      style: {
        axisLabel: {
          padding: 50,
        },
      },
    },
    yAxis: {
      tickFormat: 'formatNumberAsK',
      showGrid: true,
      label: 'VAR_label',
      style: {
        axisLabel: {
          padding: 55,
        },
      },
    },
    legend: {
      interactive: true,
      orientation: ChartLegendOrientation.vertical,
      position: ChartLegendPosition.right,
      turncateAt: 18,
      wrapText: true,
    },
  },
  {
    id: 2,
    kind: ChartKind.group,
    parent: 1,
    template: 3,
  },
  {
    id: 3,
    kind: ChartKind.simple,
    type: 'VAR_chartType' as ChartType,
    parent: 0,
    props: {
      x: 'created_date',
      y: 'VAR_y',
    },
  },
];

const reportParams: ReportSchema = {
  layoutComponent: ReportLayout.Standard,
  layoutProps: {
    slug,
    name,
    description,
    tableHeaders,
    schema,
  },
};
export default reportParams;
