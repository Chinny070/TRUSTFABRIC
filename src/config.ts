export const network = {
  name: "StudioNet",
  chainId: 61999,
  rpcUrl: "https://studio.genlayer.com/api",
} as const;

export const contract = {
  address: "0x6BC987B2Bf586A6e800ac082494F92762B40F9aD" as `0x${string}`,
  className: "TrustFabric",
  runner: "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6",
} as const;

export const limits = {
  policyName: 96, permission: 160, purpose: 480, criteria: 12, criterion: 280,
  subject: 160, source: 512, label: 96, evidencePerCase: 8,
} as const;
