import { react2AngularDirective } from './react2angular';

import { TimePicker } from '@grafana/ui';


react2AngularDirective('timepicker', TimePicker, [
  // TODO: there are more props
  'value',
  'onChange',
  'onMoveBackward',
  'onMoveForward',
  'onZoom'
]);
