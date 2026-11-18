import type { Role } from "./capabilities";

export interface User {
  id: number;
  login: string;
  nicename: string;
  email: string;
  url: string;
  registered: string;
  displayName: string;
  role: Role;
}

export interface CreateUserInput {
  login: string;
  email: string;
  password: string;
  displayName?: string;
  nicename?: string;
  url?: string;
  role?: Role;
}
