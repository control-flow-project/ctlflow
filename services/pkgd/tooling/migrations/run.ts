import createKnex from "knex";
import configuration from "../../knexfile.js";

const database = createKnex(configuration);

try {
  await database.migrate.latest();
} finally {
  await database.destroy();
}
