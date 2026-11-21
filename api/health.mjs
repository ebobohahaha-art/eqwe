import {vercelHandler} from '../lib/vercel-handler.mjs';
export default {fetch:vercelHandler(async request=>{
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
  const response=Response.json({service:'apiduck',release:'vercel-v1',commit:process.env.VERCEL_GIT_COMMIT_SHA??null});
  return request.method==='HEAD'?new Response(null,{headers:response.headers}):response;
})};
