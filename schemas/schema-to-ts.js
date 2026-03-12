import { writeFileSync, existsSync, unlinkSync } from "fs";
import { compileFromFile } from "json-schema-to-typescript";

removeExistingFiles();

await Promise.all([
  compileFromFile("./schemas/general.json", {
    customName: () => {
      return "GeneralConfig";
    },
  }).then((ts) => {
    writeFileSync("./src/interfaces/general.d.ts", ts);
    console.log("General config interfaces were generated");
  }),
  compileFromFile("./schemas/qlik.json", {
    customName: () => {
      return "QlikConfig";
    },
  }).then((ts) => {
    writeFileSync("./src/interfaces/qlik.d.ts", ts);
    console.log("Qlik config interfaces were generated");
  }),
  compileFromFile("./schemas/notifications.json", {
    customName: () => {
      return "NotificationsConfig";
    },
  }).then((ts) => {
    writeFileSync("./src/interfaces/notifications.d.ts", ts);
    console.log("Notifications config interfaces were generated");
  }),
]);

function removeExistingFiles() {
  if (existsSync("./src/interfaces/general.d.ts"))
    unlinkSync("./src/interfaces/general.d.ts");
  if (existsSync("./src/interfaces/qlik.d.ts"))
    unlinkSync("./src/interfaces/qlik.d.ts");
  if (existsSync("./src/interfaces/notifications.d.ts"))
    unlinkSync("./src/interfaces/notifications.d.ts");
}
