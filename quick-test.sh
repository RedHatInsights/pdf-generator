#!/bin/bash
#Before you run this
# npm install
# Create the .env as described in the readme
# podman-compose up -d
# ASSETS_HOST=https://console.redhat.com npm run start:server


# Step 1: Create the PDF and capture the status ID
response=$(curl -s 'localhost:8000/api/crc-pdf-generator/v2/create' \
  -H 'content-type: application/json' \
  --data-raw $'{"payload":{"manifestLocation":"/apps/vulnerability/fed-mods.json","scope":"vulnerability","module":"./ExecutiveReport","additionalData":{"cves_by_severity":{"0to3.9":{"count":527,"known_exploit_count":1,"percentage":7},"4to7.9":{"count":6768,"known_exploit_count":29,"percentage":83},"8to10":{"count":824,"known_exploit_count":40,"percentage":10}},"cves_total":8119,"meta":{"cache_used":true,"permissions":["vulnerability:system.opt_out:read","inventory:hosts:write","inventory:hosts:read","inventory:groups:read","remediations:*:*","vulnerability:advanced_report:read","remediations:remediation:write","vulnerability:report_and_export:read","inventory:groups:write","vulnerability:vulnerability_results:read","vulnerability:*:*","remediations:*:read","remediations:*:write","inventory:hosts:read","remediations:remediation:read"]},"recent_cves":{"last30days":35,"last7days":10,"last90days":488},"rules_by_severity":{"1":{"rule_count":0,"systems_affected":0},"2":{"rule_count":0,"systems_affected":0},"3":{"rule_count":28,"systems_affected":80},"4":{"rule_count":1,"systems_affected":24}},"rules_total":29,"system_count":3403,"system_count_per_type":{"edge":0,"image":0,"rpmdnf":3403},"top_cves":[{"cvss2_score":"None","cvss3_score":"8.800","description":"A flaw was found in the integration of Active Directory and the System Security Services Daemon (SSSD) on Linux systems. In default configurations, the Kerberos local authentication plugin (sssd_krb5_localauth_plugin) is enabled, but a fallback to the an2ln plugin is possible. This fallback allows an attacker with permission to modify certain AD attributes (such as userPrincipalName or samAccountName) to impersonate privileged users, potentially resulting in unauthorized access or privilege escalation on domain-joined Linux hosts.","known_exploit":false,"rule_presence":true,"security_rule":true,"synopsis":"CVE-2025-11561","systems_affected":1944},{"cvss2_score":"None","cvss3_score":"9.100","description":"A use-after-free vulnerability was found in libxml2. This issue occurs when parsing XPath elements under certain circumstances when the XML schematron has the <sch:name path=\\\"...\\\"/> schema elements. This flaw allows a malicious actor to craft a malicious XML document used as input for libxml, resulting in the program\'s crash using libxml or other possible undefined behaviors.","known_exploit":false,"rule_presence":false,"security_rule":false,"synopsis":"CVE-2025-49794","systems_affected":1605},{"cvss2_score":"None","cvss3_score":"9.100","description":"A vulnerability was found in libxml2. Processing certain sch:name elements from the input XML file can trigger a memory corruption issue. This flaw allows an attacker to craft a malicious XML input file that can lead libxml to crash, resulting in a denial of service or other possible undefined behavior due to sensitive data being corrupted in memory.","known_exploit":false,"rule_presence":false,"security_rule":false,"synopsis":"CVE-2025-49796","systems_affected":1605}],"top_rules":[{"associated_cves":["CVE-2018-12126","CVE-2018-12127","CVE-2018-12130","CVE-2019-11091"],"description":"The kernel reports this system is vulnerable.\\n","name":"\\\"MDS\\\": CPU side-channel reported by kernel","rule_id":"CVE_2018_12130_cpu_kernel|CVE_2018_12130_CPU_KERNEL_VULNERABLE_2","severity":3,"systems_affected":96},{"associated_cves":["CVE-2018-3639"],"description":"Vulnerable microcode is installed.\\n","name":"\\\"SSBD\\\": CPU side-channel with outdated microcode","rule_id":"CVE_2018_3639_cpu_kernel|CVE_2018_3639_CPU_BAD_MICROCODE_2","severity":3,"systems_affected":21},{"associated_cves":["CVE-2019-11135"],"description":"Vulnerable kernel versions are installed.\\n","name":"\\\"TAA\\\" (kernel): Side-channel","rule_id":"CVE_2019_11135_cpu_taa|CVE_2019_11135_CPU_TAA_KERNEL","severity":3,"systems_affected":2}],"isLightspeedEnabled":true}}}')

# Step 2: Extract the UUID from the response
uuid=$(echo "$response" | jq -r '.statusID')

echo "Status ID: $uuid"

sleep 5

# Step 3: Download the PDF using the UUID
curl "localhost:8000/api/crc-pdf-generator/v2/download/$uuid" > report.pdf

echo "PDF saved to report.pdf"
