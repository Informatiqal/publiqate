import {
  NotificationChangeType,
  NotificationObjectType,
} from "qlik-repo-api/dist/types/interfaces";
import winston from "winston";
import { NotificationsConfig1, NotificationsConfig2 } from "./notifications";
import { GeneralConfig } from "./general";
import { QlikConfig } from "./qlik";

export type NotificationObjectTypeExt = NotificationObjectType | "DataAlert";

export type LogLevel = "crit" | "error" | "warning" | "info" | "debug";

export type LogLevelsDetailed = {
  core: LogLevel;
  qlik?: LogLevel;
  admin?: LogLevel;
  plugins?: LogLevel;
  [key: string]: LogLevel;
};

export type LogLevels = LogLevel | LogLevelsDetailed;

export interface CookieSecret {
  name: string;
  value: string;
}

export interface BuiltInPlugins {
  echo: true;
  http: true;
  file: true;
}

export interface GeneralConfig1 {
  port: number;
  uri: string;
  certs: string;
  logLevel: LogLevels;

  // vars?: string | string[];
  vars?: string;
  admin:
    | {
        cookie: CookieSecret;
        certs: string;
        port?: number;
      }
    | false;
  builtInPlugins?: Partial<BuiltInPlugins>;
}

export interface NotificationRepo1 {
  type: NotificationObjectTypeExt;
  handle?: string;
  environment: string;
  name: string;
  nameOriginal: string;
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

export interface DataAlertScalarCondition {
  type: "scalar";
  name: string;
  description?: string;
  expression: string;
  results: {
    value: string | number;
    operator?: "<" | ">" | ">=" | "<=" | "==" | "!=" | "=" | "<>";
    variation?: string;
  }[];
}

export interface DataAlertListCondition {
  type: "list";
  name: string;
  description?: string;
  fieldName: string;
  operation: "present" | "missing";
  values: (string | number)[];
}

export interface DataAlertFieldSelection {
  field: string;
  values: (string | number)[];
}

export interface DataAlertBookmarkApply {
  bookmark: string;
}

export interface DataAlertCondition {
  selections: (DataAlertFieldSelection | DataAlertBookmarkApply)[];
  conditions: (DataAlertScalarCondition | DataAlertListCondition)[];
  options?: {
    user?: string;
  };
}

// export interface NotificationDataAlert {
//   type: NotificationObjectTypeExt;
//   changeType?: "Update";
//   handle?: string;
//   environment: string;
//   name: string;
//   nameOriginal: string;
//   filter?: string;
//   "data-conditions": DataAlertCondition[];
//   options?: {
//     disableCors?: boolean;
//     enabled?: boolean;
//     whitelist?: string[];
//   };
//   callbacks: {
//     type: string;
//     enabled?: boolean;
//     details?: any;
//   }[];
// }

export type NotificationDataAlert = NotificationsConfig1 & {
  nameOriginal: string;
};

export type NotificationRepo = NotificationsConfig2 & {
  nameOriginal: string;
  handle?: string;
};

export type Notification = NotificationRepo | NotificationDataAlert;
export type Notifications = Notification[];

export interface QlikComm {
  name: string;
  host: string;
  userName?: string;
  userDir?: string;
  certs: string;
}

export interface Config {
  general: GeneralConfig;
  qlik: QlikConfig;
  notifications: Notifications;
  notificationsObj: { [k: string]: Notification };
  plugins: string[];
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
    name: string;
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
