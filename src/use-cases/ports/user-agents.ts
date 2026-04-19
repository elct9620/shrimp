export interface UserAgentsPort {
  read(): Promise<string | null>;
}
