#!/bin/bash
# Script Name: user-data.sh
# Type: EC2 launch template user data (runs once at first boot, as root)
# Location: EC2 > Launch templates > umak-elec3-bcsad-g07-lt > Advanced details > User data
# Requires: instance profile umak-elec3-bcsad-g07-ec2-role, and clerk-server.js in
#           s3://umak-elec3-bcsad-g07-code/clerk/clerk-server.js
dnf install -y nodejs
mkdir -p /opt/clerk
aws s3 cp s3://umak-elec3-bcsad-g07-code/clerk/clerk-server.js /opt/clerk/clerk-server.js

cat > /etc/clerk.env <<'EOF'
API_URL=PUT-INVOKE-URL-HERE
CLERK_KEY=PUT-THE-SAME-KEY-AS-THE-LAMBDA-VARIABLE
CLERK_USER=clerk
CLERK_PASS=PUT-A-LETTERS-AND-NUMBERS-PASSWORD
PORT=80
EOF
chmod 600 /etc/clerk.env

cat > /etc/systemd/system/clerk.service <<'EOF'
[Unit]
Description=Hardware store clerk page
After=network.target

[Service]
EnvironmentFile=/etc/clerk.env
ExecStart=/usr/bin/node /opt/clerk/clerk-server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now clerk