const rosData = {
  systems_per_state: {
    optimized: { count: 3, percentage: 9.68 },
    under_pressure: { count: 4, percentage: 12.9 },
    undersized: { count: 6, percentage: 19.35 },
    oversized: { count: 0, percentage: 0.0 },
    idling: { count: 20, percentage: 64.52 },
    waiting_for_data: { count: 0, percentage: 0.0 },
  },
  conditions: {
    io: {
      count: 4,
      percentage: 12.5,
      undersized: -1,
      oversized: -1,
      under_pressure: 4,
    },
    memory: {
      count: 14,
      percentage: 43.75,
      undersized: 6,
      oversized: 4,
      under_pressure: 4,
    },
    cpu: {
      count: 14,
      percentage: 43.75,
      undersized: 6,
      oversized: 4,
      under_pressure: 4,
    },
  },
  instance_types_highlights: {
    current: [
      {
        type: 't2.micro',
        count: 13,
        desc: 'Intel Xeon Family instance with 1 vCPUs and 1 GiB of RAM, running on AWS eu-west-2 regions',
      },
      {
        type: 't2.medium',
        count: 1,
        desc: 'Intel Xeon Family instance with 2 vCPUs and 4 GiB of RAM, running on AWS us-west-1 regions',
      },
      {
        type: 't2.micro',
        count: 13,
        desc: 'Intel Xeon Family instance with 1 vCPUs and 1 GiB of RAM, running on AWS eu-west-2 regions',
      },
      {
        type: 't2.medium',
        count: 1,
        desc: 'Intel Xeon Family instance with 2 vCPUs and 4 GiB of RAM, running on AWS us-west-1 regions',
      },
      {
        type: 't2.medium',
        count: 1,
        desc: 'Intel Xeon Family instance with 2 vCPUs and 4 GiB of RAM, running on AWS us-west-1 regions',
      },
    ],
    suggested: [],
    historical: [
      {
        type: 't2.nano',
        count: 89,
        desc: 'Intel Xeon Family instance with 1 vCPUs and 0.5 GiB of RAM, running on AWS sa-east-1 regions',
      },
      {
        type: 't2.medium',
        count: 1,
        desc: 'Intel Xeon Family instance with 2 vCPUs and 4 GiB of RAM, running on AWS us-west-1 regions',
      },
      {
        type: 't2.nano',
        count: 89,
        desc: 'Intel Xeon Family instance with 1 vCPUs and 0.5 GiB of RAM, running on AWS sa-east-1 regions',
      },
      {
        type: 't2.medium',
        count: 1,
        desc: 'Intel Xeon Family instance with 2 vCPUs and 4 GiB of RAM, running on AWS us-west-1 regions',
      },
      {
        type: 't2.medium',
        count: 1,
        desc: 'Intel Xeon Family instance with 2 vCPUs and 4 GiB of RAM, running on AWS us-west-1 regions',
      },
    ],
  },
  meta: {
    total_count: 31,
    non_optimized_count: 30,
    conditions_count: 32,
    non_psi_count: 1,
    psi_enabled_count: 7,
    stale_count: 10,
  },
};

export default rosData;
