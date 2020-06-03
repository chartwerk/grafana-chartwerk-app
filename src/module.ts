import './sass/panel.dark.scss';
import './sass/panel.light.scss';

import template from './partials/module.html';

import './timepicker';

import { GraphTooltip } from './graph_tooltip';

import { isArraySortedAscending } from './utils';

import { ChartwerkBarChart } from '@chartwerk/bar-chart';
import { ChartwerkLineChart } from '@chartwerk/line-chart';

import { MetricsPanelCtrl } from 'grafana/app/plugins/sdk';
import { TemplateSrv } from 'grafana/app/features/templating/template_srv';
import { VariableSrv } from 'grafana/app/features/templating/variable_srv';
import { QueryVariable } from 'grafana/app/features/templating/query_variable';
import { appEvents } from 'grafana/app/core/core';

import { TimeSeries, PanelEvents, TimeRange, DateTime, AbsoluteTimeRange, dateTimeForTimeZone } from '@grafana/data';
import { colors } from '@grafana/ui';

import * as moment from 'moment';
import * as _ from 'lodash';


const PLUGIN_PATH = 'public/plugins/corpglory-chartwerk-panel';
const PARTIALS_PATH = `${PLUGIN_PATH}/partials`;
const MILLISECONDS_IN_MINUTE = 60 * 1000;

enum TickOrientation {
  HORIZONTAL = 'horizontal',
  VERTICAL = 'vertical',
  DIAGONAL = 'diagonal'
}

enum TimeRangeSource {
  DASHBOARD = 'dashboard',
  PANEL = 'panel'
}

enum Visualization {
  LINE = 'line',
  BAR = 'bar'
}

enum Mode {
  STANDARD = 'Standard',
  CHARGE = 'Charge'
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
    xAxisTickFormat: '%Y-%m-%d %H:%M',
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
    timeInterval: undefined,
    override: '',
    visualization: Visualization.LINE,
    lineMode: Mode.STANDARD,
    displayWarnings: false,
    upperBound: '',
    lowerBound: '',
    hiddenMetrics: [],
  };

  tooltip?: GraphTooltip;
  ticksOrientation = _.map(TickOrientation, (name: string) => name);
  timeRangeSources = _.map(TimeRangeSource, (name: string) => name);
  visualizationTypes = _.map(Visualization, (name: string) => name);
  mode = _.map(Mode, (name: string) => name);
  warning = '';

  chartContainer?: HTMLElement;
  chart: any;

  displayedVariables: { [name: string]: { displayed: boolean, label?: string } } = {};
  series: TimeSeries[] = [];

  /** @ngInject */
  constructor(
    $scope: ng.IScope,
    $injector: ng.auto.IInjectorService,
    public templateSrv: TemplateSrv,
    public variableSrv: VariableSrv
  ) {
    super($scope, $injector);

    _.defaults(this.panel, this.panelDefaults);

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
    if(variable === undefined) {
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
    this.addEditorTab('Axes', `${PARTIALS_PATH}/tab_axes.html`, 3);
    if(this.visualization === Visualization.LINE) {
      this.addEditorTab('Confidence', `${PARTIALS_PATH}/tab_confidence.html`, 4);
    }
    this.addEditorTab('Template variables', `${PARTIALS_PATH}/tab_template_variables.html`, 5);
  }

  onRender(): void {
    this.updateVariables();
    this.updateSeriesVariables();
    this.getVisibleForSeries();

    switch(this.visualization) {
      case Visualization.LINE:
        this.chart = new ChartwerkLineChart(this.chartContainer, this.series as any, this.chartOptions);
        break;

      case Visualization.BAR:
        this.chart = new ChartwerkBarChart(this.chartContainer, this.series as any, this.chartOptions);
        break;

      default:
        throw new Error(`Uknown visualization type: ${this.visualization}`);
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

  onDataReceived(series: TimeSeries[]): void {
    this.warning = '';

    this.series = series;
    this.filterSeries();
    this.render();
  }

  onVariableUpdate(variable: QueryVariable): void {
    this.variableSrv.variableUpdated(variable, true);
  }

  onConfigChange(): void {
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

  onZoomIn(range: [number, number]): void {
    this.tooltip.clear();

    const timezone = this.dashboard.timezone;
    const from = dateTimeForTimeZone(timezone, range[0]);
    const to = dateTimeForTimeZone(timezone, range[1]);

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

  updateSeriesVariables(): void {
    // TODO: use TimeSeries type from line-chart
    // @ts-ignore
    this.series.forEach(serie => { serie.confidence = 0 });
    // @ts-ignore
    this.series.forEach(serie => { serie.mode = this.panel.lineMode });
  }

  getVisibleForSeries(): void {
    this.series.forEach(serie => {
      if(_.includes(this.hiddenMetrics, serie.target)) {
        // @ts-ignore
        serie.visible = false;
      } else {
        // @ts-ignore
        serie.visible = true;
      }
    });
  }

  // TODO: type from lib
  get chartOptions(): any {
    const eventsCallbacks = {
      zoomIn: this.onZoomIn.bind(this),
      zoomOut: this.onZoomOut.bind(this),
      mouseMove: this.onChartHover.bind(this),
      mouseOut: this.onChartLeave.bind(this),
      onLegendClick: this.onLegendClick.bind(this)
    }
    const timeInterval = {
      count: this.timeInterval || this.seriesTimeStep
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
    const options = {
      colors,
      eventsCallbacks,
      timeInterval,
      tickFormat,
      renderTicksfromTimestamps,
      labelFormat,
      confidence: this.confidence,
      bounds,
      timeRange
    };
    return options;
  }

  get templateVariables(): QueryVariable[] {
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

  get lowerBound(): string {
    return this.panel.lowerBound;
  }

  set lowerBound(alias: string) {
    this.panel.lowerBound = alias;
  }

  get visualization(): Visualization {
    return this.panel.visualization;
  }

  set visualization(alias: Visualization) {
    this.panel.visualization = alias;
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
}

export { ChartwerkCtrl, ChartwerkCtrl as PanelCtrl };
