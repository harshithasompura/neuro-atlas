import next from "eslint-config-next";

const config = [...next, { ignores: [".next/**", ".cache/**", ".tmp/**", "node_modules/**"] }];

export { config as default };
