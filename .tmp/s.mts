import { SERV_SCHEMAS } from '../packages/reasoning/src/schemas';
console.log(JSON.stringify(SERV_SCHEMAS.screen, null, 1));
console.log(JSON.stringify(SERV_SCHEMAS.propose).slice(0, 500));
