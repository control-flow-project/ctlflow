import createKnex from "knex";
import configuration from "../../knexfile.js";
import {
  provisionPolicy
} from "../provision/provision-policy.js";

const database = createKnex(configuration);

try {
  await database.migrate.latest();
  await provisionPolicy(database);
} finally {
  await database.destroy();
}
