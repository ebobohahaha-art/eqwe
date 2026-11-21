import {spawnSync} from 'node:child_process';
import {vercelOrigin} from './vercel-origin.mjs';
process.env.PUBLIC_ORIGIN=vercelOrigin();
for(const args of [['scripts/package-connectors.mjs'],['--test','test/*.test.mjs']]){
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
  if(result.status!==0)process.exit(result.status??1);
}
