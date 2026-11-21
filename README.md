# Hardware Store Quotation Requests

ELEC3 Cloud Computing, Final Exam, Track B, Case 7. Section IV-BCSAD, Group 07.

A hardware store receives quotation requests from contractors for cement, steel bars and lumber.
A contractor sends a list of items and gets a request number. A sales clerk enters the price of
each item. The contractor reads the quotation with the request number.

Expected traffic: 50 users a day, about 4,000 requests a month.

## Architecture

| Service | Role in this build |
|---|---|
| Amazon S3 | Static contractor page (request form and quotation lookup) |
| Amazon API Gateway (HTTP API) | Four routes in front of one Lambda function |
| AWS Lambda | Creates requests, lists open ones, saves prices, returns one request by its number |
| Amazon DynamoDB | One table, `umak-elec3-bcsad-g07-requests`, on-demand capacity |
| Amazon EC2 (t3.micro) | Sales clerk page, in the public subnet of the section VPC |
| Amazon VPC | Section VPC, group 07 public subnet 10.2.7.0/24, private subnet 10.2.107.0/24 (empty) |
| AWS IAM | Existing Lambda role and EC2 role (see `iam/least-privilege-policy.json`) |

## API routes

| Route | Who | What |
|---|---|---|
| `POST /requests` | Contractor | Create a request, returns a 16-character request number |
| `GET /requests/{requestId}` | Contractor | Read status and quotation of one request |
| `GET /requests` | Clerk (key required) | List open requests, oldest first |
| `PUT /requests/{requestId}/quotation` | Clerk (key required) | Save unit prices; the total is computed on the server |

## How "only for the contractor who asked" is met

- The request number is random (64 bits), so it can't be guessed.
- Only one request can be read at a time, and only with its number.
- Listing requests and saving prices need the clerk key (`x-clerk-key`).
- The EC2 clerk page is behind a login and adds the key on the server, so it never reaches a browser.

## Repository layout

```
lambda/index.mjs                     Lambda handler
web/quotation.html                   Contractor page (set the API URL inside)
ec2/clerk-server.js                  Clerk page and API proxy (Node.js, no packages)
ec2/user-data.sh                     EC2 install steps (placeholders only)
iam/least-privilege-policy.json      Policy we would attach to the Lambda role
```

## Deploy

1. DynamoDB: create `umak-elec3-bcsad-g07-requests`, partition key `requestId` (String), on-demand.
2. Lambda: create `umak-elec3-bcsad-g07-quotation-handler` (Node.js 24.x) with the existing Lambda
   role, paste `lambda/index.mjs`, set env vars `TABLE_NAME` and `CLERK_KEY`, then Deploy.
3. API Gateway: add the four routes to `umak-elec3-bcsad-g07-api`, attach the Lambda
   (payload format 2.0), and enable CORS for the S3 website origin.
4. S3: upload `web/quotation.html` (with the Invoke URL set) to the static website bucket.
5. S3: upload `ec2/clerk-server.js` to the private code bucket under `clerk/`.
6. EC2: security group with HTTP 80 only, then launch a t3.micro in the public subnet with the
   EC2 role and `ec2/user-data.sh` (fill in the real values in AWS only).

Secrets (the clerk key and the clerk password) are not stored in this repository.

## Known limits and the fix at ten times the users

- The clerk list uses a DynamoDB Scan. At ten times the requests, add a global secondary index on
  status and creation time and use Query.
- The clerk page uses basic authentication over plain HTTP. The fix is HTTPS (CloudFront or a
  load balancer with an ACM certificate).
- The clerk key is in a Lambda environment variable and in the user data. The fix is AWS Secrets
  Manager or Systems Manager Parameter Store.
- One EC2 instance serves the clerk page. Contractors do not depend on it.