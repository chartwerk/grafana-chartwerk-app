// file is coppied from: https://github.com/grafana/grafana/blob/master/public/app/plugins/panel/graph/data_processor.ts
import {
  DataFrame,
  dateTime,
  Field,
  FieldType,
  getFieldDisplayName,
  getTimeField,
  TimeRange,
} from '@grafana/data';
import TimeSeries from 'grafana/app/core/time_series2';

import _ from 'lodash';

type Options = {
  dataList: DataFrame[];
  range?: TimeRange;
};
const DEFAULT_COLOR = '#37872d';

export class DataProcessor {
  // @ts-ignore
  constructor(private panel: any) { }

  getSeriesList(options: Options): TimeSeries[] {
    const list: TimeSeries[] = [];
    const { dataList, range } = options;

    if(!dataList || !dataList.length) {
      return list;
    }

    for(let i = 0; i < dataList.length; i++) {
      const series = dataList[i];
      const { timeField } = getTimeField(series);

      if(!timeField) {
        continue;
      }

      for(let j = 0; j < series.fields.length; j++) {
        const field = series.fields[j];

        if(field.type !== FieldType.number) {
          continue;
        }
        const name = getFieldDisplayName(field, series, dataList);
        const datapoints = [];

        for(let r = 0; r < series.length; r++) {
          datapoints.push([field.values.get(r), dateTime(timeField.values.get(r)).valueOf()]);
        }

        list.push(this.toTimeSeries(field, name, i, j, datapoints, list.length, range));
      }
    }
    // There was mapping for histogram type, but we remove it due to error
    return list;
  }

  private toTimeSeries(
    field: Field,
    alias: string,
    dataFrameIndex: number,
    fieldIndex: number,
    datapoints: any[][],
    index: number,
    range?: TimeRange
  ) {
    const series = new TimeSeries({
      datapoints: datapoints || [],
      alias: alias,
      color: DEFAULT_COLOR,
      unit: field.config ? field.config.unit : undefined,
      dataFrameIndex,
      fieldIndex,
    });

    if(datapoints && datapoints.length > 0 && range) {
      const last = datapoints[datapoints.length - 1][1];
      const from = range.from;

      if(last - from.valueOf() < -10000) {
        // If the data is in reverse order
        const first = datapoints[0][1];
        if(first - from.valueOf() < -10000) {
          series.isOutsideRange = true;
        }
      }
    }
    return series;
  }
}
