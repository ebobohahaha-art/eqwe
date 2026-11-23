// Exact display denomination. Existing ledger units and cost enforcement stay intact.
export const SERVICE_BALANCE_POLICY = 'usd-service-v1';
export const UNITS_PER_USD = 1000000n;
export function formatUSD(value) {
 const units=BigInt(value ?? 0), negative=units<0n, absolute=negative?-units:units;
 const fraction=(absolute%UNITS_PER_USD).toString().padStart(6,'0').replace(/0+$/,'').padEnd(2,'0');
 return `${negative?'-':''}$${(absolute/UNITS_PER_USD).toLocaleString('en-US')}.${fraction}`;
}
export function usdToUnits(value) {
 if(!/^(0|[1-9]\d{0,3})(\.\d{1,2})?$/.test(String(value)))throw new Error('Enter a USD amount with at most two decimal places.');
 const [whole,fraction='']=String(value).split('.');
 const units=BigInt(whole)*UNITS_PER_USD+BigInt(fraction.padEnd(2,'0'))*10000n;
 if(units<1n||units>1000000000n)throw new Error('Service balance must be between $0.01 and $1,000.00.');
 return units.toString();
}
