export interface DatabaseClient {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export const createDatabaseClient = (): DatabaseClient => {
  return {
    async connect() {
      // TODO: Initialize your DB connection here.
    },
    async disconnect() {
      // TODO: Tear down DB connection here.
    },
  };
};
