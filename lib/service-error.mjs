const known = {
  '28P01':['DATABASE_AUTH_FAILED','Database authentication failed. Check the Production DATABASE_URL.'],
  '3D000':['DATABASE_NOT_FOUND','The configured database does not exist. Check DATABASE_URL.'],
  '42501':['DATABASE_PERMISSION_DENIED','The database user lacks permissions for the gateway tables.'],
  '53300':['DATABASE_CONNECTION_LIMIT','Database connection limit reached. Use the database provider pooled endpoint.'],
  '42P01':['DATABASE_SCHEMA_REQUIRED','Database tables are missing. Apply the current schema.sql.'],
  '42703':['DATABASE_SCHEMA_REQUIRED','Database columns are missing. Apply the current schema.sql.'],
  'ECONNREFUSED':['DATABASE_UNREACHABLE','Database connection refused. Check its endpoint and network access.'],
  'ENOTFOUND':['DATABASE_UNREACHABLE','Database hostname could not be resolved. Check DATABASE_URL.'],
  'ETIMEDOUT':['DATABASE_TIMEOUT','Database connection timed out. Check its endpoint and network access.'],
  'DEPTH_ZERO_SELF_SIGNED_CERT':['DATABASE_TLS_FAILED','Database TLS certificate could not be verified. Use the provider verified TLS connection string.'],
  'SELF_SIGNED_CERT_IN_CHAIN':['DATABASE_TLS_FAILED','Database TLS certificate could not be verified. Use the provider verified TLS connection string.'],
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE':['DATABASE_TLS_FAILED','Database TLS certificate could not be verified. Use the provider verified TLS connection string.']
};
export function serviceError(error,phase){
  // Only allowlisted messages/codes leave the server. Never expose a raw driver
  // error, stack, query, hostname, URL, request body or credentials.
  if(error?.message==='database_not_configured')return {code:'DATABASE_NOT_CONFIGURED',message:'DATABASE_URL is missing in the Production environment.'};
  const match=phase==='reservation' ? known[error?.code]??known[error?.cause?.code] : null;
  if(match)return {code:match[0],message:match[1]};
  const code={prepare:'REQUEST_PREPARATION_FAILED',tokenizer:'INPUT_TOKENIZER_FAILED',pricing:'PRICE_CHECK_FAILED',reservation:'DATABASE_OPERATION_FAILED'}[phase]??'GATEWAY_OPERATION_FAILED';
  return {code,message:'Gateway operation failed. Check the sanitized diagnostic code in Vercel logs.'};
}
