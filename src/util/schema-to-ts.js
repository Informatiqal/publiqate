import { writeFileSync, existsSync, unlinkSync } from "fs";
import { compileFromFile } from "json-schema-to-typescript";

removeExistingFiles();

await Promise.all([
  compileFromFile("../../schemas/general.json", {
    customName: () => {
      return "GeneralConfig";
    },
  }).then((ts) => {
    writeFileSync("../interfaces/general.d.ts", ts);
    console.log("General config interfaces were generated");
  }),
  compileFromFile("../../schemas/qlik.json", {
    customName: () => {
      return "QlikConfig";
    },
  }).then((ts) => {
    writeFileSync("../interfaces/qlik.d.ts", ts);
    console.log("Qlik config interfaces were generated");
  }),
  compileFromFile("../../schemas/notifications.json", {
    customName: () => {
      return "NotificationsConfig";
    },
  }).then((ts) => {
    writeFileSync("../interfaces/notifications.d.ts", ts);
    console.log("Notifications config interfaces were generated");
  }),
]);

function removeExistingFiles() {
  if (existsSync("../interfaces/general.d.ts"))
    unlinkSync("../interfaces/general.d.ts");
  if (existsSync("../interfaces/qlik.d.ts"))
    unlinkSync("../interfaces/qlik.d.ts");
  if (existsSync("../interfaces/notifications.d.ts"))
    unlinkSync("../interfaces/notifications.d.ts");
}
