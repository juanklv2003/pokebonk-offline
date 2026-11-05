// Data we read or mutate at the upstream boundary. Unknown fields are retained.
export interface PeriodTasks { idx?: number; ids: string[]; prog: number[]; claimed: number[] }
export interface Profile extends Record<string, unknown> {
  settings: Record<string, unknown>;
  localSandbox?: boolean;
  starter?: number;
  lastSpecies?: number;
  league: number[];
  unlocked: number[];
  seen: number[];
  forms: number[];
  shinies: number[];
  classics: number[];
  research: Record<string, number>;
  lab: Record<string, number>;
  biomes: Record<string, number>;
  bag: Record<string, number>;
  medals: Record<string, number>;
  quests: Record<string, number>;
  counters: Record<string, number>;
  wins: Record<string, number>;
  captured: Record<string, number>;
  bonk?: number;
  shop?: { day: number; n: Record<string, number> };
  dailyStreak?: { last: number; n: number };
  treasures: Record<string, Record<string, unknown> & {won:string[]}>;
  cosmetics: string[];
  itemsOff: string[];
  itemsOwned: string[];
  runs: (Record<string, unknown> & {id: string})[];
  stardust: number;
  totalStardust: number;
  daily?: PeriodTasks;
  weekly?: PeriodTasks;
}
export interface ReadyProfile extends Profile { daily: PeriodTasks; weekly: PeriodTasks }
export interface RunConfig extends Record<string, unknown> { boosts?: unknown[] }
export interface RunTicket { id: string; seed: number; ranked: boolean; boosts: unknown[] }
export interface RunResult extends Record<string, unknown> {
  victory?: boolean;
  progress?: {
    counters?: Record<string, number>;
    research?: Record<string, number>;
    seen?: number[]; forms?: number[]; league?: number[]; shinies?: number[]; classics?: number[];
  };
}
export type ProfileAction =
  | {k:'archive';key:string;off:boolean}
  | {k:'quest';id:string}
  | {k:'task';period:'daily'|'weekly';slot:number}
  | {k:'lab';id:string;lv:number}
  | {k:'item';key:string}
  | {k:'shop';id:string;n:number};
