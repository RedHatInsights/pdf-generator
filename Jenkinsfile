pipeline {
    agent {
        node {
            label 'rhel8-spot'
        }
    }

    options {
        timestamps()
    }

    stages {
        stage('PR Check') {
            when {
                changeRequest()
            }
            steps {
                wrap([$class: 'VaultBuildWrapper',
                    vaultSecrets: [
                        [
                            path: 'insights-cicd/ephemeral-bot-svc-account',
                            secretValues: [
                                [envVar: 'OC_LOGIN_TOKEN', vaultKey: 'oc-login-token'],
                                [envVar: 'OC_LOGIN_SERVER', vaultKey: 'oc-login-server']
                            ]
                        ],
                        [
                            path: 'app-sre/quay/cloudservices-push',
                            secretValues: [
                                [envVar: 'QUAY_USER', vaultKey: 'user'],
                                [envVar: 'QUAY_TOKEN', vaultKey: 'token']
                            ]
                        ],
                        [
                            path: 'insights-cicd/rh-registry-pull',
                            secretValues: [
                                [envVar: 'RH_REGISTRY_USER', vaultKey: 'user'],
                                [envVar: 'RH_REGISTRY_TOKEN', vaultKey: 'token']
                            ]
                        ]
                    ]
                ]) {
                    sh './pr_check.sh'
                }
            }
        }

        stage('Build') {
            when {
                branch pattern: 'main|security-compliance', comparator: 'REGEXP'
            }
            steps {
                wrap([$class: 'VaultBuildWrapper',
                    vaultSecrets: [
                        [
                            path: 'app-sre/quay/cloudservices-push',
                            secretValues: [
                                [envVar: 'QUAY_USER', vaultKey: 'user'],
                                [envVar: 'QUAY_TOKEN', vaultKey: 'token']
                            ]
                        ],
                        [
                            path: 'insights-cicd/rh-registry-pull',
                            secretValues: [
                                [envVar: 'RH_REGISTRY_USER', vaultKey: 'user'],
                                [envVar: 'RH_REGISTRY_TOKEN', vaultKey: 'token']
                            ]
                        ]
                    ]
                ]) {
                    sh './build_deploy.sh'
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
    }
}
