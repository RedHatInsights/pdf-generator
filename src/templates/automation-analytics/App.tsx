import React, { FC } from 'react';
import reportMapper from './Components/ReportComponents';
import { getReport } from './schemas/index';
import PageOptionsContext from './PageOptionsContext';
import { ApiReturnType } from './Components/ChartHelpers/types';
import { SchemaParams } from './schemas/types';

interface Props {
  slug?: string;
  data?: ApiReturnType;
  extraData?: ApiReturnType;
  schemaParams?: SchemaParams;
  chartSeriesHiddenProps?: boolean[];
  puppeteerParams?: {
    pageWidth: number;
    pageHeight: number;
  };
}

const App: FC<Props> = ({
  slug,
  data,
  extraData,
  schemaParams,
  chartSeriesHiddenProps,
  puppeteerParams,
}) => {
  const report = getReport({
    slug,
    schemaParams,
  });

  document.title = report.layoutProps.name;
  const Report = reportMapper(report.layoutComponent);

  const returnReport = () => (
    /*
     * Ignoring this line because TS cannot derive the correct params
     * even though has all the information for it and it is correct.
     */
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    <Report {...report.layoutProps} data={data} extraData={extraData} />
  );

  return (
    <PageOptionsContext.Provider
      value={{ ...puppeteerParams, chartSeriesHiddenProps }}
    >
      {returnReport()}
    </PageOptionsContext.Provider>
  );
};

export default App;
