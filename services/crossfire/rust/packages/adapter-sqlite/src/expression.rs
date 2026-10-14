use diesel::sql_types::{BigInt, Integer, Nullable, Text};

#[diesel::declare_sql_function]
extern "SQL" {
    fn coalesce(value: Nullable<BigInt>, otherwise: BigInt) -> BigInt;
    fn lower(value: Text) -> Text;
    fn instr(value: Text, substring: Text) -> Integer;
    #[aggregate]
    #[sql_name = "sum"]
    fn sum_integer(value: BigInt) -> Nullable<BigInt>;
}
