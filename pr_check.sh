#!/bin/bash

# --------------------------------------------
# Options that must be configured by app owner
# --------------------------------------------
export APP_NAME="crc-pdf-generator"  # name of app-sre "application" folder this component lives in
export COMPONENT_NAME="crc-pdf-generator"  # name of app-sre "resourceTemplate" in deploy.yaml for this component
export IMAGE="quay.io/cloudservices/crc-pdf-generator"
export WORKSPACE=${WORKSPACE:-$APP_ROOT}  # if running in jenkins, use the build's workspace
export APP_ROOT=$(pwd)
# Don't deploy all the dependencies
export OPTIONAL_DEPS_METHOD="none"

# IQE_PLUGINS="e2e"
# IQE_MARKER_EXPRESSION="smoke"
# IQE_FILTER_EXPRESSION=""
# IQE_CJI_TIMEOUT="30m"

# Install bonfire repo/initialize
CICD_URL=https://raw.githubusercontent.com/RedHatInsights/bonfire/master/cicd
curl -s $CICD_URL/bootstrap.sh > .cicd_bootstrap.sh && source .cicd_bootstrap.sh

# Need to make a dummy results file to make tests pass
mkdir -p $WORKSPACE
cat << EOF > $WORKSPACE/artifacts/junit-dummy.xml
<testsuite tests="1">
    <testcase classname="dummy" name="dummytest"/>
</testsuite>
EOF

# Validate the OpenAPI spec with each pull request
source $APP_ROOT/docs/validateOpenAPI.sh

# Build and publish image to quay
source $CICD_ROOT/build.sh

source $CICD_ROOT/deploy_ephemeral_env.sh
