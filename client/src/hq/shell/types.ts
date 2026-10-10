import type { Capabilities, HqNavigation, MapSurface, ShellState, SourceState } from '../contracts';
export interface ShellViewContext {
  readonly state: ShellState;
  readonly sourceState: SourceState;
  readonly navigation: HqNavigation;
  readonly surface: MapSurface;
  readonly capabilities: Capabilities;
}
