# notifiQation

`notifiQation` is an extendable notification handler for Qlik Sense (QSEoW).

QSEoW have [Notification API](https://help.qlik.com/en-US/sense-developer/May2024/Subsystems/RepositoryServiceAPI/Content/Sense_RepositoryServiceAPI/RepositoryServiceAPI-Notification-Create-Change-Subscription.htm) which can call specific URL when specified events are raised (like tasks failures, node/services down, any entity creation/deletion/update etc).

`notifiQation` abstracts the notifications registration and maintenance. It allows you to describe the notifications in yaml file and it will take care of the rest.

## Plugins

### Built-in

3 built-in plugins are available out of the box:

- `http` - send the notification data to a specified url (POST request)
- `file` - write the notification data into a file (json. Each notification on a new line)
- `echo` - just logs the notification data into the `notifiQation` logs

### Custom plugins

`notifiQation` can load custom build plugins. The plugins should export a single JS function (`implementation`) and `notifiQation` will pass the data to it. The plugins can utilize whatever packages are needed and to be build to a ESM package (ideally into a single file).

The very basic plugin:

```js
export function implementation(callback, notification, logger) {
  // do something with the notification data
}
```

3 arguments will be passed to the implementation function:

- `callback` - the part of the config callback that is associated with that notification
- `notification` - the actual notification data
- `logger` - logger instance. Write anything to the log file with it (instance of [Winston logger](https://github.com/winstonjs/winston))

`notification` argument have the following structure:

```js
{
  config: {}, // full notification config (from the config file)
  environment: {}, // Qlik env details (from the config file)
  data: [], // the notification data
  entity: [] // full Qlik entity data that raised the notification
}
```

## Config

Config is separated in 4 sections:

### General

Config the general behavior of `notifiQation`

```yaml
general:
  port: # on which port notifiqation will receive the notifications
  uri: "192.168.137.1"
  certs: # path to pem certificates if need the qlik -> notifiqation comms to be https. Only valid certificates!
  logLevel: # log levels: debug, info, error, warning, crit. Default is info
  vars: # check the "Config variables" section
  admin:
    port: # onl which port the admin UI to be started
    cookie: # name and value of a cookie to be accepted by the admin api endpoints
      name: # cookie name
      value: # cookie value
    certs: # path to pem certificates for the admin UI
```

### Qlik

Multiple Qlik instances can be defined. When `notifiqation` starts it will connect to all of them and will create the required notifications.

```yaml
qlik:
  - name: # name of the qlik environment'
    certs: # path to qlik's certificates
    host: # machine name of the central node
    userName: # which user to use when communicating with Qlik. Default sa_scheduler
    userDir: # above user's directory. Default INTERNAL
```

### Plugins (optional)

Define list with plugins to be loaded.

```yaml
plugins:
  - name: # plugin name
    path: # full path to the js file with the plugin code
```

### Notifications

The "main" part where the actual notifications are defined.

```yaml
notifications:
  - type: ExecutionResult
    environment: # name of the Qlik environment
    name: # name of the notification
    id: # unique ID of the notification
    filter:
    condition:
    changeType:
    propertyName:
    options:
      disableCors: # if true the notification endpoint can be accessed from everywhere. Default is false
      whitelist: # list of hosts that can access the notification endpoint. Default is the Qlik central node machine name
        - my-link.com
        - 192.168.0.1
      enabled: # true or false. If false then when Qlik sends the notification nothing will be triggered here
      getEntityDetails: # if true notifiqation will retrieve full entity details from Qlik
    callbacks: # what to do when notification is received. Multiple callbacks can be triggered for single notification.
      - type: http # the name of the plugin
        details: # details associated with the plugin
          method: post
          url: http://localhost:3000
      - type: file # another plugin
        details:
          path: c:\some\file.json
```

## Config variables

It is possible to use variables file to store any sensitive values (passwords, api keys, secrets etc). The variables files location is specified in the `general.vars` property.

```txt
user_name=SomeUser
user_password=my-secret-password
```

```yaml
general:
---
vars: c:\path\to\variables.txt
---
callbacks:
  - type: smtp
    details:
      user: ${user_name}
      password: ${user_password}
```

In the config file variables are defined with `${...}`. From the above example the content of `${user_name}` will be replaced with the respective value from the `variables.txt` file.

Variables can be used for any property of the config file.

## Installation

TBA
