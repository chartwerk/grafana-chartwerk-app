// this file is copied from Grafana 6.7.x
// public/app/core/utils/react2angular.ts

import { coreModule } from 'grafana/app/core/core';
import { provideTheme } from './ConfigProvider';

export function react2AngularDirective(name: string, component: any, options: any) {
  coreModule.directive(name, [
    'reactDirective',
    reactDirective => {
      return reactDirective(provideTheme(component), options);
    },
  ]);
}
