import './sass/panel.dark.scss';
import './sass/panel.light.scss';

import template from './partials/module.html';

import './timepicker';

import { GraphTooltip } from './graph_tooltip';

import { isArraySortedAscending } from './utils';

import { isVersionGtOrEq } from './utils/version';

import { ChartwerkBarChart, BarOptions, BarTimeSerie } from '@chartwerk/bar-chart';
import { ChartwerkLineChart, LineOptions, LineTimeSerie, Mode, TimeFormat, TickOrientation } from '@chartwerk/line-chart';
import { ChartwerkGaugePod } from '@chartwerk/gauge-pod';

import { MetricsPanelCtrl } from 'grafana/app/plugins/sdk';
import { TemplateSrv } from 'grafana/app/features/templating/template_srv';
import { VariableSrv } from 'grafana/app/features/templating/variable_srv';
import { QueryVariable } from 'grafana/app/features/templating/query_variable';
import { appEvents } from 'grafana/app/core/core';

import {
  PanelEvents,
  TimeRange,
  DateTime,
  AbsoluteTimeRange,
  dateTimeForTimeZone,
  getValueFormat,
  formattedValueToString
} from '@grafana/data';
// TODO: import and use ChartWerk colors from @chartwerk/core
import { colors as grafanaColorPalette } from '@grafana/ui';

import * as moment from 'moment';
import * as _ from 'lodash';


const PLUGIN_PATH = 'public/plugins/corpglory-chartwerk-panel';
const PARTIALS_PATH = `${PLUGIN_PATH}/partials`;
const MILLISECONDS_IN_MINUTE = 60 * 1000;
const DEFAULT_GAUGE_COLOR = '#37872d';
const DEFAULT_GAUGE_BACKGROUND_COLOR = 'rgba(38, 38, 38, 0.1)';
const DEFAULT_GAUGE_ICON_SIZE = 40;


enum TimeRangeSource {
  DASHBOARD = 'dashboard',
  PANEL = 'panel'
}

enum Pod {
  LINE = 'line',
  BAR = 'bar',
  GAUGE = 'gauge'
}

enum Condition {
  EQUAL = '=',
  GREATER = '>',
  LESS = '<',
  GREATER_OR_EQUAL = '>=',
  LESS_OR_EQUAL = '<=',
}

enum Aggregation {
  MIN = 'min',
  MAX = 'max',
  LAST = 'last'
}

enum IconPosition {
  UPPER_LEFT = 'Upper left',
  MIDDLE = 'Middle',
  UPPER_RIGHT = 'Upper right'
}

type Serie = {
  alias: string;
  target: string;
  color: string;
  datapoints: [number, number][];
};
type Table = {
  color: string,
  columns: { text: string, displayNameFromDS?: string, displayName?: string }[],
  rows: number[][],
  type: string
};

type IconConfig = {
  position: IconPosition;
  url: string;
  metric: string;
  conditions: Condition[];
  values: number[];
  size: number;
}
type AxisRange = [number, number] | undefined;

// TODO: agg Gauge types when all pods are inherited from the same @chartwerk/core version
type ChartwerkTimeSerie = BarTimeSerie | LineTimeSerie;
type ChartwerkOptions = BarOptions | LineOptions;
type GaugeThreshold = {
  color: string,
  value: number,
  isUsingMetric: boolean,
  metric: string
}

if (window.grafanaBootData.user.lightTheme) {
  window.System.import('plugins/corpglory-chartwerk-panel/css/panel.light.css!');
} else {
  window.System.import('plugins/corpglory-chartwerk-panel/css/panel.dark.css!');
}

class ChartwerkCtrl extends MetricsPanelCtrl {
  static template = template;
  panelDefaults = {
    displayedVariablesNames: [],
    xAxisOrientation: TickOrientation.HORIZONTAL,
    xAxisTickFormat: '%H:%M',
    timeRangeSource: TimeRangeSource.DASHBOARD,
    timeRangeOverride: {
      from: moment(),
      to: moment(),
      raw: {
        from: moment(),
        to: moment()
      }
    },
    confidence: 0,
    timeInterval: 30,
    override: '',
    pod: Pod.LINE,
    timeFormat: TimeFormat.MINUTE,
    lineMode: Mode.STANDARD,
    displayWarnings: false,
    upperBound: '',
    lowerBound: '',
    hiddenMetrics: [],
    gaugeThresholds: [],
    gaugeUrl: '',
    defaultGaugeColor: DEFAULT_GAUGE_COLOR,
    valueDecimals: 1,
    gaugeOptions: {
      valueFontSize: 16,
      backgroundColor: DEFAULT_GAUGE_BACKGROUND_COLOR,
      reversed: false,
    },
    gaugeMaxValue: {
      value: null,
      isUsingMetric: false,
      metric: null
    },
    gaugeMinValue: {
      value: null,
      isUsingMetric: false,
      metric: null
    },
    unit: 'none',
    gaugeIcons: [],
    yScaleMin: {
      value: null,
      isUsingMetric: false,
      metric: null
    },
    yScaleMax: {
      value: null,
      isUsingMetric: false,
      metric: null
    },
  };

  tooltip?: GraphTooltip;
  ticksOrientation = _.map(TickOrientation, (name: string) => name);
  timeRangeSources = _.map(TimeRangeSource, (name: string) => name);
  podTypes = _.map(Pod, (name: string) => name);
  timeFormats = _.map(TimeFormat, (name: string) => name);
  mode = _.map(Mode, (name: string) => name);
  conditions = _.map(Condition, (name: string) => name);
  warning = '';
  iconPositions = IconPosition;

  chartContainer?: HTMLElement;
  chart: any;

  displayedVariables: { [name: string]: { displayed: boolean, label?: string } } = {};
  series: ChartwerkTimeSerie[] = [];

  isPanelTimeRangeSupported = true;

  isFirstRendering = true;

  /** @ngInject */
  constructor(
    $scope: ng.IScope,
    $injector: ng.auto.IInjectorService,
    public templateSrv: TemplateSrv
  ) {
    super($scope, $injector);
    _.defaults(this.panel, this.panelDefaults);

    this._checkGrafanaVersion();

    this.events.on(PanelEvents.editModeInitialized, this.onInitEditMode.bind(this));
    this.dashboard.events.on('time-range-updated', this.onDashboardTimeRangeChange.bind(this));

    appEvents.on('graph-hover', this._onGraphHover.bind(this));
    appEvents.on('graph-hover-clear', this._onGraphHoverClear.bind(this));

    this.updateVariables();
    this.initTimeRange();

    this.tooltip = new GraphTooltip(this.dashboard);
  }

  link(scope: ng.IScope, elem: ng.IAugmentedJQuery): void {
    const containers = elem[0].getElementsByClassName('chartwerk-container');
    if(containers.length === 0) {
      throw new Error(`Can't render: there is no .chartwerk-container div`);
    }
    this.chartContainer = containers[0] as HTMLElement;

    this.events.on(PanelEvents.render, this.onRender.bind(this));
    this.events.on(PanelEvents.dataReceived, this.onDataReceived.bind(this));
  }

  setVariable(variableName: string, value: string): void {
    const variable = _.find(this.templateVariables, variable => variable.name === variableName);
    if(variable === undefined && this.variableSrv !== undefined) {
      const variable = this.variableSrv.createVariableFromModel({
        type: 'constant',
        name: variableName,
        current: { value },
        hide: 2
      });

      this.variableSrv.addVariable(variable);
    } else {
      variable.current.value = value;
    }
  }

  initTimeRange(): void {
    switch(this.timeRangeSource) {
      case TimeRangeSource.DASHBOARD:
        this.onDashboardTimeRangeChange();
        break;
      case TimeRangeSource.PANEL:
        this.setPanelTimeRange(this.timeRangeOverride, true);
        break;
      default:
        throw new Error(`${this.timeRangeSource} TimeRangeSource doesn't exist`);
    }
  }

  onTimeRangeApplyClick(newTimeRange: TimeRange): void {
    switch(this.timeRangeSource) {
      case TimeRangeSource.DASHBOARD:
        this.timeSrv.setTime(newTimeRange);
        break;
      case TimeRangeSource.PANEL:
        this.setPanelTimeRange(newTimeRange);
        break;
      default:
        throw new Error(`${this.timeRangeSource} TimeRangeSource doesn't exist`);
    }
  }

  onDashboardTimeRangeChange(): void {
    if(this.panel.timeRangeSource === TimeRangeSource.DASHBOARD) {
      this.updateTimeRange();
      const range = this.range;
      // TODO: maybe we shouldn't refresh in this case
      this.setPanelTimeRange(range);
    }
  }

  setPanelTimeRange(newTimeRange: TimeRange, shouldRefreshAfterChange: boolean = true): void {
    if(!this.isPanelTimeRangeSupported) {
      return;
    }

    this.timeRangeOverride = newTimeRange;

    const timezone = this.dashboard.timezone;
    this.setVariable(`__cw_timeFilterFrom_${this.panel.id}`, dateTimeForTimeZone(timezone, newTimeRange.from).format());
    this.setVariable(`__cw_timeFilterTo_${this.panel.id}`, dateTimeForTimeZone(timezone, newTimeRange.to).format());

    if(shouldRefreshAfterChange) {
      this.refresh();
    }
  }

  // TODO: event type from lib
  onChartHover(evt: any): void {
    // TODO: panel
    this.tooltip.show({ pageX: evt.x, pageY: evt.y }, { time: evt.time, series: evt.series });
    if(this.isTimePickerLocked === true) {
      const pos = {
        ctrlKey: false,
        metaKey: false,
        pageX: evt.x,
        pageY: evt.y,
        panelRelY: 0.11,
        x: evt.time,
        x1: evt.time,
        y: evt.y,
        y1: evt.y
      }
      let graphEvt = { panel: this.panel, pos };
      appEvents.emit('graph-hover', graphEvt);
    }
  }

  onChartLeave(): void {
    this.tooltip.clear();
    if(this.isTimePickerLocked === true) {
      appEvents.emit('graph-hover-clear');
    }
  }

  _onGraphHover(evt): void {
    if(
      this.chart === undefined || this.chart.renderSharedCrosshair === undefined ||
      this.isTimePickerLocked === false || this.panel.id === evt.panel.id
    ) {
      return;
    }
    // TODO: use watcher instead of public method
    this.chart.renderSharedCrosshair(evt.pos.x);
  }

  _onGraphHoverClear() {
    if(this.chart === undefined || this.chart.hideSharedCrosshair === undefined || this.isTimePickerLocked === false) {
      return;
    }
    // TODO: use watcher instead of public method
    this.chart.hideSharedCrosshair();
  }

  onInitEditMode(): void {
    this.addEditorTab('Visualization', `${PARTIALS_PATH}/tab_visualization.html`, 2);
    if(this.pod !== Pod.GAUGE) {
      this.addEditorTab('Axes', `${PARTIALS_PATH}/tab_axes.html`, 3);
    }
    if(this.pod === Pod.LINE) {
      this.addEditorTab('Confidence', `${PARTIALS_PATH}/tab_confidence.html`, 4);
    }
    this.addEditorTab('Template variables', `${PARTIALS_PATH}/tab_template_variables.html`, 5);
    if(this.pod === Pod.GAUGE) {
      this.addEditorTab('Gauge', `${PARTIALS_PATH}/tab_gauge.html`, 6);
      this.addEditorTab('Colors', `${PARTIALS_PATH}/tab_colors.html`, 7);
    }
  }

  private _getThresholdValue(threshold: GaugeThreshold): number | null {
    if(!threshold.isUsingMetric) {
      return threshold.value;
    }

    const serie = this._getSerieByTarget(threshold.metric);
    if(serie === undefined) {
      return null;
    }

    if(serie.datapoints.length === 0) {
      return null;
    } else {
      // TODO: maybe make it able to use some aggregation?
      return _.last(serie.datapoints)[0];
    }
  }

  private _getSerieByTarget(target: string): ChartwerkTimeSerie | undefined {
    const serie = _.find(this.series, serie => serie.target === target);
    if(serie === undefined) {
      console.error(`Can't find metric named ${target}`);
      return undefined;
    }
    return serie;
  }

  onRender(): void {
    this.updateVariables();

    this.extendGrafanaSeriesWithChartwerkOptions();

    switch(this.pod) {
      case Pod.LINE:
        // TODO: do not re-create pod instance each time, just update series / options
        // @ts-ignore
        this.chart = new ChartwerkLineChart(this.chartContainer, this.series, this.chartOptions);
        this.chart.render();
        break;

      case Pod.BAR:
        // @ts-ignore
        this.chart = new ChartwerkBarChart(this.chartContainer, this.series, this.chartOptions);
        this.chart.render();
        break;

      case Pod.GAUGE:
        if(this.isFirstRendering) {
          setTimeout(() => {
            this.chart = new ChartwerkGaugePod(this.chartContainer, this.series, this.chartOptions as any);
            this.chart.render();

            this.isFirstRendering = false;
          }, 500);
        } else {
          this.chart = new ChartwerkGaugePod(this.chartContainer, this.series, this.chartOptions as any);
          this.chart.render();
        }
        break;

      default:
        throw new Error(`Unknown pod type: ${this.pod}`);
    }
  }

  filterSeries(): void {
    this.series.forEach(serie => {
      if(serie.datapoints === undefined) {
        return;
      }
      const filteredDatapoints = _.filter(serie.datapoints, item => item !== undefined);
      if(filteredDatapoints.length !== serie.datapoints.length) {
        this.addMessageToWarning('WARNING: datasource returned dataset with undefined datapoints, skip these datapoints.');
        serie.datapoints = filteredDatapoints;
      }
      let timestamps = _.map(serie.datapoints, item => item[1]);
      let uniqTimestamps: number[] = [];

      const isSorted = isArraySortedAscending(timestamps);
      if(!isSorted) {
        this.addMessageToWarning('WARNING: datasource returned unsorted dataset, performance can go down.<br/> You can add sort by time to the query to fix it.');
        serie.datapoints = _.sortBy(serie.datapoints, item => item[1]);
        timestamps = _.map(serie.datapoints, item => item[1]);
      }
      uniqTimestamps = _.sortedUniq(timestamps);

      if(timestamps.length === uniqTimestamps.length) {
        return;
      }
      this.addMessageToWarning('WARNING: there are multiple data points with same timestamp, rendered only one of these.');
      let datapointsWithUniqTimestamps = [];
      uniqTimestamps.forEach(timestamp => {
        const idx = _.sortedIndexOf(timestamps, timestamp);
        datapointsWithUniqTimestamps.push(serie.datapoints[idx]);
      });
      serie.datapoints = datapointsWithUniqTimestamps;
    });
  }

  addMessageToWarning(message: string): void {
    if(this.warning.indexOf(message) !== -1) {
      return;
    }
    this.warning += message + '<br/>';
  }

  getVariableByName(variableName: string): QueryVariable {
    return _.find(this.templateVariables, variable => variable.name === variableName);
  }

  onDataReceived(series: Serie[] | [Table]): void {
    this.warning = '';

    this.setSeries(series);
    this.filterSeries();
    this.render();
  }

  setSeries(series: Serie[] | [Table]): void {
    if(series.length > 0 && (series[0] as Table).type === 'table') {
      this.series = this.getSeriesFromTableData((series[0] as Table));
    } else {
      this.series = series as Serie[];
    }
  }

  getSeriesFromTableData(data: Table): Serie[] {
    if(data.columns[0] === undefined || data.columns[0].text !== 'Time') {
      const message = 'Map Error: First table column must be "Time"';
      this.addMessageToWarning(message);
      throw new Error(message);
    }
    const metricsNames = data.columns
      .filter(column => column.text !== 'Time')
      .map(column => column.displayNameFromDS || column.displayName || column.text);
    // TODO: Maybe use time column index;
    const timeColumn = data.rows.map(row => row[0]);

    const series = metricsNames.map((name, idx) => {
      const metricColumnIdx = idx + 1; // metricColumnIdx === 0 for time;
      const metricColumn = data.rows.map(row => row[metricColumnIdx]);
      const datapoints = _.zip(metricColumn, timeColumn);
      return {
        alias: name,
        target: name,
        color: 'red',
        datapoints
      }
    });
    return series;
  }

  onVariableUpdate(variable: QueryVariable): void {
    if(this.variableSrv !== undefined) {
      this.variableSrv.variableUpdated(variable, true);
    }
  }

  onConfigChange(): void {
    console.log('onConfigChange');
    this.render();
  }

  isDisplayed(variableName: string): boolean {
    return _.includes(this.panel.displayedVariablesNames, variableName);
  }

  toggleVariableDisplay(variableName: string): void {
    if(!this.isDisplayed(variableName)) {
      this.panel.displayedVariablesNames.push(variableName);
    } else {
      this.panel.displayedVariablesNames = _.filter(
        this.panel.displayedVariablesNames,
        name => variableName !== name
      );
    }
  }

  updateVariables(): void {
    for(const variable of this.templateVariables) {
      // dunno why, there is no "label" field in QueryVariable type, but it exists
      // @ts-ignore
      const currentLabel = variable.label;
      const variableExists = variable.name in this.displayedVariables;
      if(!variableExists) {
        this.displayedVariables[variable.name] = {
          displayed: this.isDisplayed(variable.name),
          label: currentLabel
        };
      }

      const labelChanged = this.displayedVariables[variable.name].label !== currentLabel;
      if(labelChanged) {
        this.displayedVariables[variable.name].label = currentLabel;
      }
    }
  }

  // this method is copied from Grafana 6.7.x
  // public/app/core/utils/timePicker.ts
  // TODO: move to utils
  getZoomedTimeRange(range: TimeRange, factor: number): AbsoluteTimeRange {
    const timespan = range.to.valueOf() - range.from.valueOf();
    const center = range.to.valueOf() - timespan / 2;

    const to = center + (timespan * factor) / 2;
    const from = center - (timespan * factor) / 2;

    return { from, to };
  }

  // TODO: refactor zoom-in and zoom-out
  onZoomOut(): void {
    this.tooltip.clear();

    switch(this.timeRangeSource) {
      case TimeRangeSource.DASHBOARD:
        this.publishAppEvent('zoom-out', 2);
        break;
      case TimeRangeSource.PANEL:
        const newTimeRange = this.getZoomedTimeRange(this.timeRangeOverride, 2);
        const timezone = this.dashboard.timezone;

        const from = dateTimeForTimeZone(timezone, newTimeRange.from);
        const to = dateTimeForTimeZone(timezone, newTimeRange.to);
        this.setPanelTimeRange({
          from, to,
          raw: { from, to }
        });
        break;
      default:
        throw new Error(`${this.timeRangeSource} TimeRangeSource doesn't exist`);
    }
  }

  onZoomIn(range: [AxisRange, AxisRange]): void {
    this.tooltip.clear();
    if(range === undefined || range[0] === undefined) {
      return;
    }
    const timestampRange = range[0];
    const timezone = this.dashboard.timezone;
    const from = dateTimeForTimeZone(timezone, timestampRange[0]);
    const to = dateTimeForTimeZone(timezone, timestampRange[1]);

    switch(this.timeRangeSource) {
      case TimeRangeSource.DASHBOARD:
        this.timeSrv.setTime({
          from,
          to,
        });
        break;
      case TimeRangeSource.PANEL:
        this.setPanelTimeRange({
          from, to,
          raw: { from, to }
        });
        break;
      default:
        throw new Error(`${this.timeRangeSource} TimeRangeSource doesn't exist`);
    }
  }

  onLegendClick(idx: number): void {
    this.updateHiddenMetrics(this.series[idx].target);
    this.render();
  }

  onLockClick(): void {
    switch(this.timeRangeSource) {
      case TimeRangeSource.DASHBOARD:
        this.timeRangeSource = TimeRangeSource.PANEL;
        break;
      case TimeRangeSource.PANEL:
        this.timeRangeSource = TimeRangeSource.DASHBOARD;
        break;
      default:
        throw new Error(`${this.timeRangeSource} TimeRangeSource doesn't exist`);
    }
    this.initTimeRange();
  }

  extendGrafanaSeriesWithChartwerkOptions(): void {
    this.series.forEach((serie: ChartwerkTimeSerie, idx: number) => {
      // TODO: handle case when not all pods have some option
      if(this.pod === Pod.LINE) {
        (serie as LineTimeSerie).mode = this.panel.lineMode;
      }

      serie.color = grafanaColorPalette[idx];

      serie.visible = !_.includes(this.hiddenMetrics, serie.target);
    });
  }

  setUnit(unit: string): void {
    this.panel.unit = unit;
    this.onConfigChange();
  }

  get chartOptions(): ChartwerkOptions {
    const eventsCallbacks = {
      zoomIn: this.onZoomIn.bind(this),
      zoomOut: this.onZoomOut.bind(this),
      mouseMove: this.onChartHover.bind(this),
      mouseOut: this.onChartLeave.bind(this),
      onLegendClick: this.onLegendClick.bind(this),
      onLegendLabelClick: () => {}
    }

    const renderTicksfromTimestamps = false;
    const tickFormat = {
      xAxis: this.xAxisTickFormat,
      xTickOrientation: this.xAxisOrientation
    };
    const labelFormat = {
      yAxis: this.yAxisLabel,
      xAxis: this.xAxisLabel
    }
    const bounds = {
      upper: this.upperBound,
      lower: this.lowerBound
    }
    // @ts-ignore
    const timeRange = { from: this.timeRangeOverride.from._i, to: this.timeRangeOverride.to._i }

    const stops = this.gaugeThresholds.map(
      threshold => ({ color: threshold.color, value: this._getThresholdValue(threshold) })
    );

    const icons = this.gaugeIcons
      .map(icon => {
        const serie = this._getSerieByTarget(icon.metric);
        const lastValue = this._getAggregatedValueFromSerie(serie);
        if(lastValue !== null) {
          if(this._satifiesCondition(lastValue, icon.values, icon.conditions)) {
            const position = this._getChartwerkGaugePosition(icon.position);
            return { src: icon.url, position, size: icon.size  };
          }
        }
        return undefined;
      })
      .filter(icon => icon !== undefined);

    const options = {
      eventsCallbacks,
      axis: {
        x: {
          format: 'time',
        },
        y: {
          format: 'numeric',
          range: this.yScaleRange
        }
      },
      tickFormat,
      renderTicksfromTimestamps,
      labelFormat,
      confidence: this.confidence,
      bounds,
      timeRange,
      maxValue: this.gaugeMaxValue,
      minValue: this.gaugeMinValue,
      valueFormatter: this.valueFormatter,
      stops,
      defaultColor: this.defaultGaugeColor,
      icons,
      valueFontSize: this.panel.gaugeOptions.valueFontSize,
      valueArcBackgroundColor: this.panel.gaugeOptions.backgroundColor,
      reversed: this.panel.gaugeOptions.reversed
    };
    // @ts-ignore
    return options;
  }

  get yScaleRange(): AxisRange {
    if(this.yScaleMin === null && this.yScaleMax === null) {
      return undefined;
    }
    let min = this.yScaleMin;
    // TODO: refactor core
    if(min === null) {
      min = _.min(this.series.map(
        serie => {
          return this._getAggregatedValueFromSerie(serie, Aggregation.MIN);
        }
      ));
    }
    let max = this.yScaleMax;
    if(max === null) {
      max = _.max(this.series.map(
        serie => {
          return this._getAggregatedValueFromSerie(serie, Aggregation.MAX);
        }
      ));
    }
    return [min, max];
  }

  get valueFormatter(): (value: number) => string {
    const formatter = getValueFormat(this.unit);

    return (value: number) => {
      const formattedValue = formatter(value, this.valueDecimals);
      return formattedValueToString(formattedValue);
    };
  }

  get variableSrv(): VariableSrv | undefined {
    // TODO: use SemVersion comparison
    if(this.grafanaVersion.length !== null && this.grafanaVersion === '7') {
      return undefined;
    }
    return this.$injector.get('variableSrv');
  }

  get grafanaVersion(): string | null {
    if(_.has(window, 'grafanaBootData.settings.buildInfo.version')) {
      return window.grafanaBootData.settings.buildInfo.version;
    }
    return null;
  }

  get templateVariables(): QueryVariable[] {
    // it's deprecated
    return this.templateSrv.variables;
  }

  get shouldDisplayVariables(): boolean {
    for(const variable in this.displayedVariables) {
      if(this.displayedVariables[variable].displayed === true) {
        return true;
      }
    }
    return false;
  }

  get xAxisOrientation(): TickOrientation {
    return this.panel.xAxisOrientation;
  }

  set xAxisOrientation(orientation: TickOrientation) {
    this.panel.xAxisOrientation = orientation;
  }

  get timeRangeSource(): TimeRangeSource {
    return this.panel.timeRangeSource;
  }

  set timeRangeSource(timeRangeSource: TimeRangeSource) {
    this.panel.timeRangeSource = timeRangeSource;
  }

  get xAxisTickFormat(): string {
    return this.panel.xAxisTickFormat;
  }

  set xAxisTickFormat(format: string) {
    this.panel.xAxisTickFormat = format;
  }

  get xAxisLabel(): string {
    return this.panel.xAxisLabel;
  }

  set xAxisLabel(label: string) {
    this.panel.xAxisLabel = label;
  }

  get yAxisLabel(): string {
    return this.panel.yAxisLabel;
  }

  set yAxisLabel(label: string) {
    this.panel.yAxisLabel = label;
  }

  get unit(): string {
    return this.panel.unit;
  }

  get timeRangeOverride(): TimeRange {
    return {
      from: moment(this.panel.timeRangeOverride.from) as DateTime,
      to: moment(this.panel.timeRangeOverride.to) as DateTime,
      raw: this.panel.timeRangeOverride.raw
    };
  }

  set timeRangeOverride(timeRange: TimeRange) {
    // TODO: copy?
    this.panel.timeRangeOverride = timeRange;
  }

  get isTimePickerLocked(): boolean {
    return this.timeRangeSource === TimeRangeSource.DASHBOARD;
  }

  get confidence(): number {
    return this.panel.confidence;
  }

  set confidence(confidence: number) {
    this.panel.confidence = confidence;
  }

  get timeInterval(): number {
    return this.panel.timeInterval;
  }

  set timeInterval(interval: number) {
    this.panel.timeInterval = interval;
  }

  get override(): string {
    return this.panel.override;
  }

  set override(alias: string) {
    this.panel.override = alias;
  }

  get upperBound(): string {
    return this.panel.upperBound;
  }

  set upperBound(alias: string) {
    this.panel.upperBound = alias;
  }

  get gaugeMaxValue(): number | null {
    if(this.isUsingMetricForGaugeMaxValue === false) {
      return this.maxValue;
    }
    const serie = this._getSerieByTarget(this.maxGaugeValueMetric);
    return this._getAggregatedValueFromSerie(serie);
  }

  private _getAggregatedValueFromSerie(serie: ChartwerkTimeSerie | undefined, aggregation = Aggregation.LAST): number | null {
    if(serie === undefined) {
      return null;
    }
    if(serie.datapoints.length === 0) {
      return null;
    }
    // TODO: maybe make it able to use some aggregation?
    switch(aggregation) {
      case Aggregation.LAST:
        return _.last(serie.datapoints)[0];
      case Aggregation.MIN:
        return _.min(serie.datapoints.map(row => row[0]));
      case Aggregation.MAX:
        return _.max(serie.datapoints.map(row => row[0]));
      default:
        throw new Error(`Unknown aggregation type: ${aggregation}`)
    }
  }

  private _getChartwerkGaugePosition(iconPosition: IconPosition): string {
    switch(iconPosition) {
      case IconPosition.MIDDLE:
        return 'middle';
      case IconPosition.UPPER_LEFT:
        return 'left';
      case IconPosition.UPPER_RIGHT:
        return 'right';
      default:
        throw new Error(`Unknown Icon Position type: ${iconPosition}`);
    }
  }

  get gaugeMinValue(): number | null {
    if(this.isUsingMetricForGaugeMinValue === false) {
      return this.minValue;
    }
    const serie = this._getSerieByTarget(this.minValueGaugeMetric);
    return this._getAggregatedValueFromSerie(serie);
  }

  get maxValue(): number {
    return this.panel.maxValue;
  }

  set maxValue(alias: number) {
    this.panel.maxValue = alias;
  }

  get isUsingMetricForGaugeMaxValue(): boolean {
    return this.panel.gaugeMaxValue.isUsingMetric;
  }

  set isUsingMetricForGaugeMaxValue(val: boolean) {
    this.panel.gaugeMaxValue.isUsingMetric = val;
  }

  get maxGaugeValueMetric(): string | null {
    if(this.isUsingMetricForGaugeMaxValue === false) {
      return null;
    }
    return this.panel.gaugeMaxValue.metric;
  }

  set maxGaugeValueMetric(metric: string | null) {
    this.panel.gaugeMaxValue.metric = metric;
  }

  get minValue(): number {
    return this.panel.gaugeMinValue.value;
  }

  set minValue(value: number) {
    this.panel.gaugeMinValue.value = value;
  }

  get isUsingMetricForGaugeMinValue(): boolean {
    return this.panel.gaugeMinValue.isUsingMetric;
  }

  set isUsingMetricForGaugeMinValue(val: boolean) {
    this.panel.gaugeMinValue.isUsingMetric = val;
  }

  get minValueGaugeMetric(): string | null {
    if(this.isUsingMetricForGaugeMinValue === false) {
      return null;
    }
    return this.panel.gaugeMinValue.metric;
  }

  set minValueGaugeMetric(metric: string | null) {
    this.panel.gaugeMinValue.metric = metric;
  }

  get isUsingMetricForYScaleMaxValue(): boolean {
    return this.panel.yScaleMax.isUsingMetric;
  }

  set isUsingMetricForYScaleMaxValue(val: boolean) {
    this.panel.yScaleMax.isUsingMetric = val;
  }

  get isUsingMetricForYScaleMinValue(): boolean {
    return this.panel.yScaleMin.isUsingMetric;
  }

  set isUsingMetricForYScaleMinValue(val: boolean) {
    this.panel.yScaleMin.isUsingMetric = val;
  }

  get yScaleMinValue(): number {
    return this.panel.yScaleMin.value;
  }

  set yScaleMinValue(value: number) {
    this.panel.yScaleMin.value = value;
  }

  get yScaleMaxValue(): number {
    return this.panel.yScaleMax.value;
  }

  set yScaleMaxValue(value: number) {
    this.panel.yScaleMax.value = value;
  }

  get minValueYScaleMetric(): string | null {
    if(this.isUsingMetricForYScaleMinValue === false) {
      return null;
    }
    return this.panel.yScaleMin.metric;
  }

  set minValueYScaleMetric(metric: string | null) {
    this.panel.yScaleMin.metric = metric;
  }

  get maxValueYScaleMetric(): string | null {
    if(this.isUsingMetricForYScaleMaxValue === false) {
      return null;
    }
    return this.panel.yScaleMax.metric;
  }

  set maxValueYScaleMetric(metric: string | null) {
    this.panel.yScaleMax.metric = metric;
  }

  get yScaleMin(): number | null {
    if(this.isUsingMetricForYScaleMinValue === false) {
      return this.yScaleMinValue;
    }
    const serie = this._getSerieByTarget(this.minValueYScaleMetric);
    return this._getAggregatedValueFromSerie(serie);
  }

  get yScaleMax(): number | null {
    if(this.isUsingMetricForYScaleMaxValue === false) {
      return this.yScaleMaxValue;
    }
    const serie = this._getSerieByTarget(this.maxValueYScaleMetric);
    return this._getAggregatedValueFromSerie(serie);
  }

  get valueDecimals(): number {
    return this.panel.valueDecimals;
  }

  set valueDecimals(decimals: number) {
    this.panel.valueDecimals = decimals;
  }

  get lowerBound(): string {
    return this.panel.lowerBound;
  }

  set lowerBound(alias: string) {
    this.panel.lowerBound = alias;
  }

  get upperLeftIconURL(): string {
    return this.panel.upperLeftIconURL;
  }

  set upperLeftIconURL(url: string) {
    this.panel.upperLeftIconURL = url;
  }

  get upperLeftIcon(): IconConfig {
    return this.panel.upperLeftIcon;
  }

  get upperRightIcon(): IconConfig {
    return this.panel.upperRightIcon;
  }

  get middleIcon(): IconConfig {
    return this.panel.middleIcon;
  }

  get pod(): Pod {
    return this.panel.pod;
  }

  set pod(value: Pod) {
    this.panel.pod = value;
  }

  get timeFormat(): TimeFormat {
    return this.panel.timeFormat;
  }

  set timeFormat(format: TimeFormat) {
    this.panel.timeFormat = format;
  }

  get defaultGaugeColor(): string {
    return this.panel.defaultGaugeColor;
  }

  set defaultGaugeColor(color: string) {
    this.panel.defaultGaugeColor = color;
  }

  get gaugeThresholds(): GaugeThreshold[] {
    return this.panel.gaugeThresholds;
  }

  get gaugeIcons(): IconConfig[] {
    return this.panel.gaugeIcons;
  }

  get metricNames(): string[] {
    if(
      this.series === undefined ||
      this.series.length === 0
    ) {
      return [];
    }
    return this.series.map(serie => serie.target);
  }

  addGaugeThreshold(): void {
    const defaultThreshold = {
      value: 0,
      color: DEFAULT_GAUGE_COLOR,
      isUsingMetric: false,
      metric: ''
    }
    this.panel.gaugeThresholds.push(defaultThreshold);
    this.onConfigChange();
  }

  deleteGaugeThreshold(idx: number): void {
    let thresholds = _.cloneDeep(this.gaugeThresholds);
    thresholds.splice(idx, 1);
    this.panel.gaugeThresholds = thresholds;
    this.onConfigChange();
  }

  getGaugeThreshold(idx: number): GaugeThreshold {
    if(this.panel.gaugeThresholds.length < idx) {
      throw new Error(`Gauge Threshold doesn't exist for idx: ${idx} `);
    }
    return this.panel.gaugeThresholds[idx];
  }

  addGaugeIcon(): void {
    const defaultIcon = {
      url: '',
      metric: '',
      position: IconPosition.UPPER_LEFT,
      conditions: [Condition.EQUAL],
      values: [0],
      size: DEFAULT_GAUGE_ICON_SIZE
    }
    this.panel.gaugeIcons.push(defaultIcon);
    this.onConfigChange();
  }

  addCondition(icon: IconConfig): void {
    icon.conditions.push(Condition.EQUAL);
    icon.values.push(0);
    this.onConfigChange();
  }

  deleteCondition(icon: IconConfig, idx: number) {
    icon.conditions.splice(idx, 1);
    icon.values.splice(idx, 1);
    this.onConfigChange();
  }

  deleteGaugeIconByIdx(idx: number): void {
    let icons = _.cloneDeep(this.gaugeIcons);
    icons.splice(idx, 1);
    this.panel.gaugeIcons = icons;
    this.onConfigChange();
  }

  // TODO: not "| undefined"
  get seriesTimeStep(): number | undefined {
    if(this.series.length === 0 || this.series[0].datapoints.length < 2) {
      return undefined;
    }
    const timestampInterval = this.series[0].datapoints[1][1] - this.series[0].datapoints[0][1];
    return timestampInterval / MILLISECONDS_IN_MINUTE;
  }

  get hiddenMetrics(): string[] {
    return this.panel.hiddenMetrics;
  }

  set hiddenMetrics(metricNames: string[]) {
    this.panel.hiddenMetrics = metricNames;
  }

  get lineMode(): Mode {
    return this.panel.lineMode;
  }

  set lineMode(mode: Mode) {
    this.panel.lineMode = mode;
  }

  get shouldDisplayWarnings(): boolean {
    return this.panel.displayWarnings;
  }

  set shouldDisplayWarnings(displayed: boolean) {
    this.panel.displayWarnings = displayed;
  }

  get gaugeLink(): string {
    return this.panel.gaugeLink;
  }

  set gaugeLink(url: string) {
    this.panel.gaugeLink = url;
  }

  get isChartwerkContainerClickable(): boolean {
    if(this.gaugeLink === undefined || this.gaugeLink.length === 0) {
      return false;
    }
    return true;
  }

  goToLink(): void {
    if(this.gaugeLink === undefined || this.gaugeLink.length === 0) {
      return;
    }
    const url = this.templateSrv.replace(this.gaugeLink);
    const redirectWindow = window.open(url, '_Self');
    redirectWindow.location;
  }

  updateHiddenMetrics(metricName: string) {
    const isIncluded = _.includes(this.hiddenMetrics, metricName);
    let metricList = this.hiddenMetrics;
    if(isIncluded === true) {
      this.hiddenMetrics = metricList.filter(e => e !== metricName)
    } else {
      metricList.push(metricName)
      this.hiddenMetrics = metricList;
    }
  }

  private _satifiesCondition(leftValue: number, rightValues: number[], conditions: Condition[]): boolean {
    for(let idx = 0; idx < conditions.length; idx++) {
      switch(conditions[idx]) {
        case Condition.EQUAL:
          if(leftValue !== rightValues[idx]) {
            return false;
          }
          break;
        case Condition.GREATER:
          if(leftValue < rightValues[idx]) {
            return false;
          }
          break;
        case Condition.LESS:
          if(leftValue > rightValues[idx]) {
            return false;
          }
          break;
        case Condition.GREATER_OR_EQUAL:
          if(leftValue <= rightValues[idx]) {
            return false;
          }
          break;
        case Condition.LESS_OR_EQUAL:
          if(leftValue >= rightValues[idx]) {
            return false;
          }
          break;
        default:
          throw new Error(`Unknown condition: ${conditions[idx]}`);
      }
    }
    
    return true;
  }

  private _checkGrafanaVersion(): void {
    const grafanaVersion = this._grafanaVersion;
    if(grafanaVersion === null) {
      throw new Error('Unknown Grafana version. Only Grafana 6.6.1+ is supported');
    }
    if(!isVersionGtOrEq(grafanaVersion, '6.6.1')) {
      throw new Error(`Unsupported Grafana version: ${grafanaVersion}`);
    }
    if(isVersionGtOrEq(grafanaVersion, '7.0.0')) {
      this.isPanelTimeRangeSupported = false;
    }
  }

  private get _grafanaVersion(): string {
    if(_.has(window, 'grafanaBootData.settings.buildInfo.version')) {
      return window.grafanaBootData.settings.buildInfo.version;
    }
    return null;
  }
}

export { ChartwerkCtrl, ChartwerkCtrl as PanelCtrl };
