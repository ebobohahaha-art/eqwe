# Planned production domain

Target: **https://oopengate.vercel.app**

This source is prepared for that domain. It does not create a Vercel project, claim the hostname, change DNS, or publish a deployment.

When you are ready:

1. Deploy the complete source package to the Vercel project that will use `oopengate.vercel.app`, with the existing `npm run build:vercel` build command and `public` output directory.
2. Retain the existing `DATABASE_URL` to keep customer keys, credit balances and audit history. Configure your existing `ADMIN_ACCESS_KEY` and provider/inference environment settings in the new project's runtime if using a different Vercel project.
3. Remove any old `PUBLIC_ORIGIN` override, so Vercel's production URL is detected automatically, or set Production `PUBLIC_ORIGIN=https://oopengate.vercel.app`. Do not leave the old hostname in that variable.
4. Rebuild after setting the hostname. The build generates customer connector ZIPs and checksums for the selected origin.
5. Open `https://oopengate.vercel.app/admin` with the administrator key. Customer login remains at the same origin.

The admin upgrade uses the existing schema. No new database migration or package dependency is required. Upload the API and `lib/` files as well as `public/`; the new admin's search, pagination and customer history need the updated admin handler.
