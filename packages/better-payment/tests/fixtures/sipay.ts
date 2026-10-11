// Sipay fixtures. Response shapes as returned by the Sipay test environment
// (provisioning.sipay.com.tr); ids and amounts are made up unless noted.

/** Made-up credentials; never use real ones in tests */
export const SIPAY_TEST = {
  appId: 'test-app-id',
  appSecret: 'test-app-secret',
  merchantKey: 'test-merchant-key',
};

export const SIPAY_BASE_URL = 'https://provisioning.sipay.com.tr';

/**
 * A hash key encrypted with Node's crypto as Sipay does (the reverse of the
 * "Hash Validation" reference code) and the test app secret, for the payment
 * result fields Sipay posts after 3D Secure
 */
export const SIPAY_REFERENCE_HASH_KEY =
  '0123456789abcdef:a1b2:J3v+eSuMITtIyU__TQQ8KEbj4eQKOOT7Nkz0td1TvB8uxn6qe0Fs5Rn__ci6aMA6PYfziJi996pEIdoergEUcQfg==';
export const SIPAY_REFERENCE_HASH_PLAIN = '1|10.00|BP3D1791714553140|VP17917145548423635|TRY';

export const SIPAY_TOKEN_RESPONSE = {
  status_code: 100,
  status_description: 'Successfully Generated token',
  data: { token: 'test-token', is_3d: 1, expires_at: '2026-10-11 15:25:29' },
};

export const SIPAY_UNAUTHENTICATED = {
  success: false,
  statuscode: 101,
  message: 'Unauthenticated.',
  status_code: 101,
  status_description: 'Unauthenticated.',
};

export function sipayPaymentResponse(overrides: Record<string, unknown> = {}) {
  return {
    status_code: 100,
    status_description: 'Payment process successful',
    data: {
      sipay_status: 1,
      order_no: 'VP1791714383141836',
      order_id: 'VP1791714383141836',
      invoice_id: 'ORDER2D',
      sipay_payment_method: 1,
      credit_card_no: '450803****4509',
      transaction_type: 'Auth',
      payment_status: 1,
      payment_method: 1,
      error_code: 100,
      error: 'Başarılı',
      auth_code: '679984',
      installment: 1,
      amount: 1.2,
      hash_key: 'c39abe1c58d89dfc:9d75:UX1gBpJ35YlCsGKqyASxWqe__da8fE3pT__i5bJmCa57riW8kAkiiIYF',
      original_bank_error_code: '',
      original_bank_error_description: '',
      ...overrides,
    },
  };
}

/** paySmart2D declined by the bank (insufficient funds) */
export const SIPAY_PAYMENT_DECLINED = {
  status_code: 41,
  status_description: 'Limit yetersiz',
  data: {
    sipay_status: 0,
    order_no: 'VP17917143852558833',
    order_id: 'VP17917143852558833',
    invoice_id: 'ORDER2D',
    transaction_type: 'Auth',
    payment_status: 0,
    error_code: '51',
    error: 'Limit yetersiz',
    auth_code: null,
    original_bank_error_code: '51',
    original_bank_error_description: 'Limit yetersiz',
  },
};

/** paySmart3D accepted: Sipay answers with a form posting the card to the 3D Secure page */
export const SIPAY_3D_HTML = `<!doctype html>
<html lang="en"><head><title>3DS Page</title></head>
<body>
    <div style="display: none">
        <form id="3dsForm" name="3dsForm" action="https://dummypos.sipay.com.tr/payment/3d" method="POST">
            <input type="hidden" name="invoice_id" value="VP17917144147503468">
<input type="hidden" name="amount" value="1.2">
<input type="hidden" name="return_url" value="https://provisioning.sipay.com.tr/ccpayment/payment/dummy_payment/return3d?brand_order_id=VP17917144147503468">
<input type="hidden" name="language" value="tr">
        </form>
    </div>
    <script type="text/javascript">document.getElementById("3dsForm").submit();</script>
</body></html>`;

/** paySmart3D rejected: Sipay answers with a form posting the error to cancel_url */
export const SIPAY_3D_REJECTED_HTML = `
        <form id="the-form" method="POST" action="https://example.com/callback"><input type="hidden" name="sipay_status" value="0">
<input type="hidden" name="order_no" value="">
<input type="hidden" name="order_id" value="">
<input type="hidden" name="invoice_id" value="ORDER3D">
<input type="hidden" name="status_code" value="68">
<input type="hidden" name="status_description" value="Invalid hash key">
<input type="hidden" name="payment_status" value="0">
<input type="hidden" name="error_code" value="68">
<input type="hidden" name="error" value="Invalid hash key">
<input type="hidden" name="hash_key" value="71a203309490b625:11c3:jSQERr4u3SVhNT__bw25wOq4D1ELqnDNwK+ZaIyjjMM4=">
</form>`;

/** Fields Sipay posts to return_url after a successful 3D Secure payment (hash_key added by the test) */
export function sipayCallback(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    sipay_status: '1',
    order_no: 'VP17917145548423635',
    order_id: 'VP17917145548423635',
    invoice_id: 'ORDER3D',
    status_code: '100',
    status_description: 'Payment Successfully Completed',
    sipay_payment_method: '1',
    credit_card_no: '450803****4509',
    transaction_type: 'Auth',
    payment_status: '1',
    payment_method: '1',
    error_code: '100',
    error: 'Payment Successfully Completed',
    auth_code: '115923',
    installment: '1',
    amount: '1.2',
    md_status: '1',
    original_bank_error_code: '',
    original_bank_error_description: '',
    ...overrides,
  };
}

export function sipayStatusResponse(overrides: Record<string, unknown> = {}) {
  return {
    status_code: 100,
    status_description: 'An order has been taken place for this invoice id: ORDER1',
    transaction_status: 'Completed',
    order_id: 'VP17917145548423635',
    transaction_id: 'N3qx0-sjCx-TC10-18309-111026',
    message: 'An order has been taken place for this invoice id: ORDER1',
    reason: '',
    bank_status_code: '',
    bank_status_description: '',
    invoice_id: 'ORDER1',
    total_refunded_amount: 0,
    product_price: '10',
    transaction_amount: 10,
    ref_number: '',
    transaction_type: 'Auth',
    original_bank_error_code: '',
    original_bank_error_description: '',
    cc_no: '45080345****4509',
    refund_info: [],
    md_status: 1,
    installment: 1,
    card_type: 'CREDIT CARD',
    ...overrides,
  };
}

export const SIPAY_STATUS_NOT_FOUND = {
  status_code: 32,
  status_description: 'Geçersiz fatura kimliği',
  transaction_status: 'Failed',
  order_id: '',
  transaction_id: '',
  message: 'Geçersiz fatura kimliği',
  reason: 'No Request found for this invoice id',
  invoice_id: 'MISSING',
  total_refunded_amount: 0,
  product_price: '0',
  transaction_amount: 0,
  original_bank_error_code: '',
  original_bank_error_description: '',
};

export const SIPAY_REFUND_RESPONSE = {
  status_code: 100,
  status_description: 'Refund completed successfully',
  order_no: 'VP17917145548423635',
  invoice_id: 'ORDER1',
  ref_no: '602800085396',
  ref_number: '602800085396',
  remaining_refundable_amount: 7,
};

export const SIPAY_POS_RESPONSE = {
  status_code: 100,
  status_description: 'Successfull',
  data: [
    {
      pos_id: 76,
      installments_number: 3,
      card_type: 'CREDIT CARD',
      card_program: 'MAXIMUM',
      card_scheme: 'mastercard',
      is_commercial: 'FALSE',
      payable_amount: 105,
      amount_to_be_paid: '105.00',
      currency_code: 'TRY',
      title: '3 installments',
      card_bank: 'T. IS BANKASI A.S.',
      bank_code: '0064',
    },
    {
      pos_id: 76,
      installments_number: 1,
      card_type: 'CREDIT CARD',
      card_program: 'MAXIMUM',
      card_scheme: 'mastercard',
      is_commercial: 'FALSE',
      payable_amount: 100,
      amount_to_be_paid: '100.00',
      currency_code: 'TRY',
      title: 'Single payment',
      card_bank: 'T. IS BANKASI A.S.',
      bank_code: '0064',
    },
  ],
};
