import { react2AngularDirective } from './react2angular';

import { TimeRangePicker } from '@grafana/ui';


react2AngularDirective('timepicker', TimeRangePicker, [
  // TODO: there are more props
  'value',
  'onChange',
  'onMoveBackward',
  'onMoveForward',
  'onZoom'
]);
