import React, { FC, Fragment } from 'react';
import { Td, Tr } from '../../../StyledPatternfly';
import { getText } from '../helpers';
import {
  ExpandRowsComponentType,
  LegendEntry,
  TableHeaders,
} from '../../types';

interface Props {
  legendEntry: LegendEntry;
  headers: TableHeaders;
  ExpandRowsComponent?: ExpandRowsComponentType;
}

const TableRow: FC<Props> = ({ legendEntry, headers, ExpandRowsComponent }) => {
  return (
    <Fragment>
      <Tr>
        {headers.map(({ key }) => (
          <Td key={`${legendEntry.id}-${key}`}>{getText(legendEntry, key)}</Td>
        ))}
      </Tr>
      {ExpandRowsComponent && <ExpandRowsComponent item={legendEntry} />}
    </Fragment>
  );
};

export default TableRow;
