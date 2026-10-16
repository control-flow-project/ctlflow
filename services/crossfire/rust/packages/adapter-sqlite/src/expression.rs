use diesel::sql_types::{BigInt, Nullable};

#[diesel::declare_sql_function]
extern "SQL" {
    fn coalesce(value: Nullable<BigInt>, otherwise: BigInt) -> BigInt;
    #[aggregate]
    #[sql_name = "sum"]
    fn sum_integer(value: BigInt) -> Nullable<BigInt>;
}
