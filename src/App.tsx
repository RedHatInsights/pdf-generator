import React, { FC, useEffect } from 'react';
import '@patternfly/react-core/dist/styles/base.css';
import reportMapper, { ReportLayout } from './Components/ReportComponents';
import { getReport } from './pdf/schemas/index';
import PageOptionsContext from './PageOptionsContext';
import { ApiReturnType } from './Components/ChartHelpers/types';

interface Props {
  label: string;
  y: string;
  xTickFormat: string;
  slug: string;
  data: ApiReturnType;
  extraData: ApiReturnType;
  pageWidth: number;
  pageHeight: number;
}

const App: FC<Props> = ({
  label,
  y,
  xTickFormat,
  slug,
  data,
  extraData,
  pageWidth,
  pageHeight,
}) => {
  const report = getReport(slug);

  if (!report) {
    // This should happen only in development.
    throw new Error(`The report (${slug}) is not implemented.`);
  }

  useEffect(() => {
    document.title = report.name;
  }, [report]);

  const Report = reportMapper(report?.componentName ?? ReportLayout.Standard);

  return (
    <PageOptionsContext.Provider value={{ pageWidth, pageHeight }}>
      <Report
        tableHeaders={report.tableHeaders}
        data={data}
        extraData={extraData}
        schema={report.schemaFnc(label, y, xTickFormat)}
        name={report.name}
        description={report.description}
        ExpandRowsComponent={report.ExpandRowsComponent}
      />
    </PageOptionsContext.Provider>
  );
};

export default App;
