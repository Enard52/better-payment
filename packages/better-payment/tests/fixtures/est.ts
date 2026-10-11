// EST (Asseco) fixtures. Store values are made up; hashes are computed
// independently (Python hashlib) with the ver3 algorithm.
export const EST_TEST = {
  bank: 'isbank' as const,
  clientId: '100100000',
  username: 'apiuser',
  password: 'apipass',
  storeKey: 'TESTSTOREKEY',
};

export const EST_FORM_FIELDS = {
  clientid: '100100000',
  storetype: '3d',
  amount: '1.20',
  oid: 'ORDER3D',
  okUrl: 'https://example.com/callback',
  failUrl: 'https://example.com/callback',
  TranType: 'Auth',
  currency: '949',
  taksit: '',
  rnd: '0123456789abcdef0123456789abcdef',
  lang: 'tr',
  hashAlgorithm: 'ver3',
  refreshTime: '0',
  Email: 'john.doe@example.com',
  pan: '5528790000000008',
  Ecom_Payment_Card_ExpDate_Month: '12',
  Ecom_Payment_Card_ExpDate_Year: '30',
  cv2: '123',
  cardType: 'mastercard',
  cardHolderName: 'John Doe',
};

export const EST_FORM_HASH =
  'ejx7A/lYNbLnY+LAYDLYwsFN7A7P1UfeHBIM0n/ARKHOBK6DryI6lQHbK7ZsdvtHfuni4/DI5NVTCcjJ69ArWw==';

/** 3d model: card verified, the merchant charges it with XML Auth */
export const EST_3D_CALLBACK = {
  clientid: '100100000',
  oid: 'ORDER3D',
  amount: '1.20',
  currency: '949',
  taksit: '',
  storetype: '3d',
  mdStatus: '1',
  md: 'MDVALUE123',
  xid: 'XIDVALUE=',
  eci: '02',
  cavv: 'CAVVVALUE=',
  mdErrorMsg: 'Authenticated',
  hashAlgorithm: 'ver3',
  rnd: '0123456789abcdef0123456789abcdef',
  Response: '',
  ProcReturnCode: '',
  encoding: 'ISO-8859-9',
  HASH: '/DO0HeanIuQx/ETIXeB4y6o/3bLMZl4qnQeyQpGnS9mj3tlyHsZ3PP8KE06IsYaEy3PGayXNjVnSusKsTUlaFg==',
};

/** 3d_pay model: the bank charged the card */
export const EST_3DPAY_CALLBACK = {
  clientid: '100100000',
  oid: 'ORDERPAY',
  amount: '1.20',
  currency: '949',
  taksit: '',
  storetype: '3d_pay',
  mdStatus: '1',
  md: 'MDVALUE123',
  xid: 'XIDVALUE=',
  eci: '02',
  cavv: 'CAVVVALUE=',
  mdErrorMsg: 'Authenticated',
  hashAlgorithm: 'ver3',
  rnd: '0123456789abcdef0123456789abcdef',
  Response: 'Approved',
  ProcReturnCode: '00',
  AuthCode: '123456',
  TransId: '26011AAAA1234',
  ErrMsg: '',
  HASH: '3udQQXgx3JMKdHwJsnTtHgV1X54DLRRf8KseAe34pLatCK6zsxZD6vnqNfZzDDnAFfruS1/G1qIdGImh1Jp2zQ==',
};

export const estXml = (fields: Record<string, string>, extra?: Record<string, string>) =>
  '<?xml version="1.0" encoding="ISO-8859-9"?><CC5Response>' +
  Object.entries(fields)
    .map(([key, value]) => `<${key}>${value}</${key}>`)
    .join('') +
  (extra
    ? `<Extra>${Object.entries(extra)
        .map(([key, value]) => `<${key}>${value}</${key}>`)
        .join('')}</Extra>`
    : '') +
  '</CC5Response>';

export const EST_APPROVED_XML = estXml(
  {
    OrderId: 'ORDER3D',
    GroupId: 'ORDER3D',
    Response: 'Approved',
    AuthCode: '123456',
    HostRefNum: '601100000001',
    ProcReturnCode: '00',
    TransId: '26011AAAA1234',
    ErrMsg: '',
  },
  { SETTLEID: '', TRXDATE: '20261011 14:00:00', HOSTMSG: 'ONAY' }
);

export const estOrderStatusXml = (extra: Record<string, string> = {}) =>
  estXml(
    {
      ErrMsg: 'Record(s) found for ORDERPAY',
      ProcReturnCode: '00',
      Response: 'Approved',
      OrderId: 'ORDERPAY',
      TransId: '26011AAAA1234',
    },
    { TRANS_STAT: 'S', CHARGE_TYPE_CD: 'S', CAPTURE_AMT: '120', ...extra }
  );
