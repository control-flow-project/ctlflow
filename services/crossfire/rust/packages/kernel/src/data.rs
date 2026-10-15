use serde::Deserialize;

pub fn required_option<'de, T: Deserialize<'de>, D: serde::Deserializer<'de>>(
    input: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::<T>::deserialize(input)
}
