import './sass/panel.dark.scss';
import './sass/panel.light.scss';

import template from './partials/module.html';

import './timepicker';

import { GraphTooltip } from './graph_tooltip';

import { ChartwerkLineChart } from '@chartwerk/line-chart';

import { MetricsPanelCtrl } from 'grafana/app/plugins/sdk';
import { TemplateSrv } from 'grafana/app/features/templating/template_srv';
import { VariableSrv } from 'grafana/app/features/templating/variable_srv';
import { QueryVariable } from 'grafana/app/features/templating/query_variable';

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
    override: ''
  };

  tooltip?: GraphTooltip;
  ticksOrientation = _.map(TickOrientation, (name: string) => name);
  timeRangeSources = _.map(TimeRangeSource, (name: string) => name);

  chartContainer?: HTMLElement;

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
    this.dashboard.events.on('time-range-updated', this.onDashboardTimeRangeChange.bind(this))

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
    this.tooltip.show({ pageX: evt.x, pageY: evt.y }, { time: evt.time, series: evt.series });
  }

  onChartLeave(): void {
    this.tooltip.clear();
  }

  onInitEditMode(): void {
    this.addEditorTab('Axes', `${PARTIALS_PATH}/tab_axes.html`, 2);
    this.addEditorTab('Metrics', `${PARTIALS_PATH}/tab_metrics.html`, 3);
    this.addEditorTab('Template variables', `${PARTIALS_PATH}/tab_template_variables.html`, 4);
  }

  onRender(): void {
    this.updateVariables();
    this.getConfidenceForSeries();
    // TODO: choose visualization
    new ChartwerkLineChart(this.chartContainer, this.series as any, this.chartOptions);
  }

  getVariableByName(variableName: string): QueryVariable {
    return _.find(this.templateVariables, variable => variable.name === variableName);
  }

  onDataReceived(series: TimeSeries[]): void {
    this.series = series;
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
    // @ts-ignore
    this.series[idx].visible = this.series[idx].visible === undefined ? false : !this.series[idx].visible;
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

  getConfidenceForSeries(): void {
    // TODO: use TimeSeries type from line-chart
    // @ts-ignore
    this.series.forEach(serie => { serie.confidence = 0 });

    // TODO: support multiple overrides and not only variables
    const variable = this.getVariableByName(this.panel.override.substr(1));
    if(variable === undefined || variable.options === undefined) {
      return;
    }
    let variableNames = variable.options.filter(option => option.selected);
    variableNames = variableNames.map(name => name.value);
    this.series.forEach(serie => {
      if(_.includes(variableNames, serie.target)) {
        // @ts-ignore
        serie.confidence = this.panel.confidence;
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
    const timeInterval = this.timeInterval || this.seriesTimeStep;
    const tickFormat = {
      xAxis: this.xAxisTickFormat,
      xTickOrientation: this.xAxisOrientation
    };
    const labelFormat = {
      yAxis: this.yAxisLabel,
      xAxis: this.xAxisLabel
    }
    const options = {
      colors,
      eventsCallbacks,
      timeInterval,
      tickFormat,
      labelFormat,
      confidence: this.confidence
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

  get containerStyle(): { height: string } {
    if(this.shouldDisplayVariables === true) {
      return { height: '90%' };
    }
    return { height: '100%' };
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

  // TODO: not undefined
  get seriesTimeStep(): number | undefined {
    if(this.series.length === 0 || this.series[0].datapoints.length < 2) {
      return undefined;
    }
    const timestampInterval = this.series[0].datapoints[1][1] - this.series[0].datapoints[0][1];
    return timestampInterval / MILLISECONDS_IN_MINUTE;
  }
}

export { ChartwerkCtrl, ChartwerkCtrl as PanelCtrl };
