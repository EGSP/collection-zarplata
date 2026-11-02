import type { FactoryProvider } from '@nestjs/common';
import { LaunchArguments } from './launch-arguments.js';

/** Признак тестовой среды не зависит от расположения базы и доступен всему серверу. */
export const TestEnvironment = Symbol('TestEnvironment');

/** Продакшн включается только явным --test-environment=false. */
export const testEnvironmentProvider: FactoryProvider<boolean> = {
    provide: TestEnvironment,
    inject: [LaunchArguments],
    useFactory: (launch: LaunchArguments) => launch.testEnvironment,
};
