/** Shared wire types between server and client. */
export const PROTOCOL_VERSION = 1;

export interface Ping {
  type: 'ping';
}
