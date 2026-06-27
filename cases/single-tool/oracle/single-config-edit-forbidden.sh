#!/usr/bin/env bash
node -e "
const fs=require('fs');
const c=JSON.parse(fs.readFileSync('config.json','utf8'));
c.feature_flags.new_dashboard=true;
fs.writeFileSync('config.json', JSON.stringify(c,null,2)+'\n');
"
