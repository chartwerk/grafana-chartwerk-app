export class GraphTooltip {

  private $tooltip: JQuery<HTMLElement>;
  private _visible = false;

  constructor(
    private dashboard: any
  ) {
    this.$tooltip = $('<div class="graph-tooltip">');
  }

  clear(): void {
    this._visible = false;
    this.$tooltip.detach()
  }

  show(
    pos: { pageX: number, pageY: number },
    seriesHoverInfo: {
      time: number,
      series: {
        value: number, color: string, label: string
      }[]
    }
  ): void {
    const absoluteTime = this.dashboard.formatDate(seriesHoverInfo.time, 'YYYY-MM-DD HH:mm:ss');

    let seriesHtml = '';
    for (let i = 0; i < seriesHoverInfo.series.length; i++) {
      const hoverInfo = seriesHoverInfo.series[i];

      let value = hoverInfo.value;

      seriesHtml += '<div class="graph-tooltip-list-item"><div class="graph-tooltip-series-name">';
      seriesHtml += '<i class="fa fa-minus" style="color:' + hoverInfo.color + ';"></i> ' + hoverInfo.label + ':</div>';
      seriesHtml += '<div class="graph-tooltip-value">' + value + '</div></div>';
    }

    this._renderAndShow(absoluteTime, seriesHtml, pos);
  };

  destroy(): void {
    this._visible = false;
    this.$tooltip.remove();
  };

  get visible(): boolean { return this._visible; }

  private _renderAndShow(absoluteTime: string, innerHtml: string, pos: { pageX: number, pageY: number }): void {
    innerHtml = '<div class="graph-tooltip-time">' + absoluteTime + '</div>' + innerHtml;
    (this.$tooltip.html(innerHtml) as any).place_tt(pos.pageX + 20, pos.pageY);
  };
}

