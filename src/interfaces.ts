import {
  NotificationChangeType,
  NotificationObjectType,
} from "qlik-repo-api/dist/types/interfaces";
import winston from "winston";

export type LogLevels = "crit" | "error" | "warning" | "info" | "debug";

export interface CookieSecret {
  name: string;
  value: string;
}

export interface GeneralConfig {
  port: number;
  uri: string;
  certs: string;
  logLevel: LogLevels;
  vars?: string;
  admin: {
    cookie: CookieSecret;
    certs: string;
    port?: number;
  };
}

export interface Notification {
  type: NotificationObjectType;
  id: string;
  environment: string;
  name?: string;
  filter?: string;
  condition?: string;
  changeType: NotificationChangeType;
  propertyName?: string;
  options?: {
    getEntityDetails?: boolean;
    disableCors?: boolean;
    enabled?: boolean;
    whitelist?: string[];
  };
  callbacks: {
    type: string;
    enabled?: boolean;
    details?: any;
  }[];
}

export interface QlikComm {
  name: string;
  host: string;
  userName?: string;
  userDir?: string;
  certs: string;
}

export interface Config {
  general: GeneralConfig;
  qlik: QlikComm[];
  notifications: Notification[];
  plugins: {
    name: string;
    path: string;
    logLevel?: LogLevels;
  }[];
}

export interface NotificationData {
  config: Notification;
  environment: QlikComm;
  data: [];
  entities: any[];
}

export interface Plugin {
  meta?: {
    version?: string;
    author?: string;
    description?: string;
  };
  implementation: (
    c: any,
    d: NotificationData,
    logger: winston.Logger
  ) => Promise<any>;
}

export interface Callback {
  details:
    | {
        method?: "get" | "post" | "put" | "delete";
        url: string;
        headers?: string[];
      }
    | any;
}
