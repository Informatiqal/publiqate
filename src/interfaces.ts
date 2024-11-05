import {
  NotificationChangeType,
  NotificationObjectType,
} from "qlik-repo-api/dist/types/interfaces";
import winston from "winston";

export interface GeneralConfig {
  port: number;
  uri: string;
  sourceWhitelist: string;
}

export interface Notification {
  type: NotificationObjectType;
  id: string;
  name?: string;
  filter?: string;
  condition?: string;
  changeType: NotificationChangeType;
  propertyName?: string;
  getEntityDetails?: boolean;
  callback: [];
}

export interface QlikComm {
  host: string;
  userName: string;
  userDir: string;
  cert: string;
  key: string;
}

export interface Config {
  general: GeneralConfig;
  qlik: QlikComm;
  notifications: Notification[];
  plugins: {
    name: string;
    path: string;
  }[];
}

export interface NotificationData {
  config: Notification;
  data: [];
  entity: any[];
}

export interface Plugin {
  meta?: {
    version?: string;
    author?: string;
    description?: string;
  };
  implementation: (c: any, d: NotificationData, logger: winston.Logger) => void;
}

export interface Callback {
  details: {
    method?: "get" | "post" | "put" | "delete";
    url: string;
    headers?: string[];
  };
}
