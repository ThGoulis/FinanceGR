# Firebase Realtime Database security review

## Finding

The supplied FinanceGR source uses unauthenticated Realtime Database REST requests (`GET`, `PATCH`, and `PUT`) against `/rooms/{roomHash}.json`. The ZIP does not include the currently deployed Realtime Database Security Rules, Firebase Authentication setup, or an authorization/room-membership model. Therefore the deployed database's actual access policy cannot be verified from this repository.

Client-side AES-GCM encryption protects payload confidentiality when the room PIN is strong and kept private. It does **not** prevent unauthorized reads, writes, deletion, denial-of-service, room-marker enumeration, or replacement of encrypted payloads. A hashed room path is not an authorization boundary.

## Safe baseline included in this repository

`firebase/database.rules.json` denies all unauthenticated and authenticated access by default. This is intentionally fail-closed. It is **not deployable as-is while the current client uses unauthenticated REST calls**; deploying it will disable Cloud Sync until an authenticated access model is implemented.

## Required work before enabling production Cloud Sync

1. Enable Firebase Authentication and sign users in from the client.
2. Send Firebase ID tokens with every Realtime Database REST request (`?auth=<ID_TOKEN>` or an equivalent supported authorization header).
3. Add a server-controlled room membership/ACL record. Rules must authorize only room members, not every authenticated user.
4. Model room creation, joining, revocation, and recovery explicitly. Do not rely on the client knowing a room hash or PIN.
5. Keep room payloads encrypted client-side, enforce payload size/schema limits, and deny writes to membership/ACL metadata from ordinary clients.
6. Test read/write denial for anonymous users, non-members, revoked members, and cross-room access before deployment.

## Deployment note

No remote Firebase project was accessed or modified during this code change. The included deny-all rules are a security baseline for a future authenticated migration, not evidence that the live Firebase instance is secured.
